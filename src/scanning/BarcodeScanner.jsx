import { useState, useRef, useEffect } from "react";
import { BARCODE_FORMATS, loadZXing, makeZXingReader, decodeLadder, validBarcodeChecksum, ocrDigits, DECODE_URL, serverDecode } from "./decode.js";
import { readBarcodeDigits } from "./photoVerification.js";

function BarcodeScanner({ onDetect, onClose, t, isMobile }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const stopRef = useRef(false);
  const [status, setStatus] = useState("starting");   // starting | scanning | error
  const [message, setMessage] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const detectorRef  = useRef(null);   // BarcodeDetector, reused for file decode
  const capturingRef = useRef(false);  // manual capture in progress
  const autoBusyRef  = useRef(false);  // background attempt in progress — must NOT block manual
  const captureNowRef = useRef(null);  // manual "Capture" action, set once scanning starts
  const fileRef      = useRef(null);
  // When every decode strategy fails the still is KEPT, not discarded. The
  // digits are printed under the barcode and a person can read them when no
  // decoder can — throwing the image away wastes the one capture that worked.
  const [failedShot, setFailedShot] = useState(null);   // { url, typed }
  const [typedCode, setTypedCode]   = useState("");
  const [readState, setReadState]   = useState(null);   // { busy } | { digits, confidence, checksumOk, note }

  // Proposes the digits from the photo. Fills the field rather than searching,
  // so the reader confirms against the pack before anything is looked up.
  async function readDigitsFromShot() {
    if (!failedShot?.base64) return;
    setReadState({ busy: true, step: "loading the reader" });
    try {
      // On-device OCR first: no API key, no cost, and the image stays here.
      const bmp = await createImageBitmap(await (await fetch(failedShot.url)).blob());
      const r = await ocrDigits(bmp, (step, p) =>
        setReadState({ busy: true, step: `${step}${p ? ` ${Math.round(p * 100)}%` : ""}` }));

      if (r.digits) {
        setReadState({ digits: r.digits, checksumOk: r.checksumOk, via: "on-device",
                       note: r.candidates.length > 1 ? `Other numbers seen: ${r.candidates.filter(x => x !== r.digits).join(", ")}.` : "" });
        setTypedCode(r.digits);
        return;
      }

      // Only if on-device OCR found nothing, and only when a key is configured.
      setReadState({ busy: true, step: "trying the cloud reader" });
      const cloud = await readBarcodeDigits(failedShot.base64);
      setReadState({ ...cloud, via: "cloud" });
      if (cloud.digits) setTypedCode(cloud.digits);
    } catch (e) {
      setReadState({ error: String(e?.message || e) });
    }
  }
  const [canTorch, setCanTorch] = useState(false);
  // Optical/digital zoom. This is the fix for a small barcode: a phone camera
  // cannot focus closer than roughly 10 cm, so moving in to fill the frame just
  // produces a blurred image. Zooming keeps the lens at a distance it can focus
  // at while making the code occupy far more pixels — which is what the decoder
  // actually needs. It is not the same as cropping: zoom happens at the sensor,
  // so it adds real detail rather than enlarging what is already lost.
  const [trackInfo, setTrackInfo] = useState(null);
  const [zoomCaps, setZoomCaps] = useState(null);   // { min, max, step }
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    stopRef.current = false;
    let zxingControls = null;
    let zxEscalationTimer = null;

    const stopAll = () => {
      stopRef.current = true;
      try { zxingControls?.stop(); } catch {}
      if (zxEscalationTimer) { clearTimeout(zxEscalationTimer); zxEscalationTimer = null; }
      streamRef.current?.getTracks().forEach(tr => tr.stop());
      streamRef.current = null;
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setMessage("This browser cannot access the camera. Type the barcode number instead.");
        return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            // 720p is not enough resolution for the thin bars of an EAN-13 at
            // normal holding distance — the decoder sees blur and keeps
            // retrying, which is why a clearly visible barcode can take ages.
            width:  { ideal: 1920 },
            height: { ideal: 1080 },
            // Without continuous autofocus the camera locks focus once, on
            // whatever was in frame at start, and never refocuses on the label.
            advanced: [{ focusMode: "continuous" }],
          },
          audio: false,
        });
      } catch (err) {
        setStatus("error");
        setMessage(
          err?.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser settings, or type the barcode number."
          : err?.name === "NotFoundError" ? "No camera was found on this device. Type the barcode number instead."
          : err?.name === "NotReadableError" ? "The camera is in use by another app. Close it and try again."
          : "The camera could not be started. Type the barcode number instead."
        );
        return;
      }
      if (stopRef.current) { stream.getTracks().forEach(tr => tr.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");   // iOS refuses fullscreen-less playback without this
        await video.play().catch(() => {});
      }
      // Torch is only available on some Android devices
      const track = stream.getVideoTracks()[0];
      // What the camera ACTUALLY granted, which is often not what was asked
      // for. A track that fell back to 640x480 explains a failure that no
      // amount of retrying or zooming will fix, so it is reported rather than
      // assumed.
      const st = track?.getSettings?.() || {};
      setTrackInfo({
        w: st.width || 0, h: st.height || 0,
        fps: Math.round(st.frameRate || 0),
        focus: st.focusMode || "unknown",
        downgraded: (st.width || 0) < 1280,
      });
      const caps = track?.getCapabilities?.() || {};
      setCanTorch(!!caps.torch);
      // Auto-zoom, not a manual slider: the escalation loops below step
      // through this range on their own when the fast decode isn't landing,
      // so a small or distant barcode gets more sensor detail without the
      // user having to do anything.
      const zoomInfo = (caps.zoom && caps.zoom.max > caps.zoom.min)
        ? { min: caps.zoom.min, max: caps.zoom.max }
        : null;
      if (zoomInfo) {
        setZoomCaps({ min: zoomInfo.min, max: zoomInfo.max, step: caps.zoom.step || 0.1 });
        setZoom(zoomInfo.min);
      }
      const stepZoom = (attempt) => {
        if (!zoomInfo) return;
        const level = zoomInfo.min + (zoomInfo.max - zoomInfo.min) * Math.min(1, attempt / 4);
        applyZoom(Math.min(zoomInfo.max, level));
      };
      setStatus("scanning");

      // Some real barcodes never pass a checksum — ITF-14 cases, worn or
      // curved labels. Rather than discard them silently (which makes the
      // scanner look frozen), two identical consecutive reads are accepted as
      // confirmation: agreement between independent frames is its own check.
      const recent = { value: null, count: 0 };
      const handle = (code) => {
        const clean = String(code).replace(/\D/g, "");
        if (!clean || clean.length < 8) return false;

        if (validBarcodeChecksum(clean)) { stopAll(); onDetect(clean); return true; }

        if (recent.value === clean) {
          recent.count++;
          if (recent.count >= 2) { stopAll(); onDetect(clean); return true; }
        } else { recent.value = clean; recent.count = 1; }

        // Tell the user something is happening rather than leaving a dead view.
        setMessage("Reading the barcode — hold steady for a moment.");
        return false;
      };

      // ── Still capture ──
      // Live video decoding fights motion blur and a low preview resolution.
      // A still is sharper: ImageCapture.takePhoto() returns the sensor's full
      // resolution, several times the video track's. Decoding that still
      // succeeds on labels the video loop never resolves — curved packaging,
      // small print, poor light.
      const captureStill = async () => {
        const track = streamRef.current?.getVideoTracks?.()[0];
        // Preferred: full-resolution photo. Chrome/Android only.
        if (track && typeof window.ImageCapture === "function") {
          try {
            const blob = await new window.ImageCapture(track).takePhoto();
            return await createImageBitmap(blob);
          } catch { /* fall through to the canvas path */ }
        }
        // Fallback: the current video frame at its native size. Lower
        // resolution than a photo, but still free of the preview's downscaling
        // and works in Firefox and on iOS.
        const v = videoRef.current;
        if (!v?.videoWidth) return null;
        const c = document.createElement("canvas");
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0);
        return await createImageBitmap(c);
      };

      // Runs the full decode ladder over a still and reports progress.
      const decodeStill = async (detector, bitmap, { fast = false, keepOnFail = true } = {}) => {
        if (!bitmap) return null;
        const r = await decodeLadder(bitmap, detector, (step) => setMessage(`Captured — ${step}…`), { fast });
        if (r) return r.code;
        // Only a deliberate capture keeps the image. Auto attempts run in the
        // background, and popping the type-the-digits panel up mid-scan while
        // the user is still framing the code is noise.
        if (keepOnFail) keepFailedShot(bitmap);
        return null;
      };

      if ("BarcodeDetector" in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats?.() || BARCODE_FORMATS;
          const detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS.filter(f => supported.includes(f)) });
          // detect() is expensive. Running it every animation frame (60/s) means
          // each call queues behind the last and the preview stutters, which
          // makes it HARDER to hold the code steady. ~12/s decodes just as well
          // and leaves the camera responsive.
          detectorRef.current = detector;

          let lastRun = 0, started = 0, lastStill = 0, stills = 0;
          const tick = async (ts) => {
            if (stopRef.current || !videoRef.current) return;
            if (!started) started = ts;

            if (ts - lastRun >= 80) {
              lastRun = ts;
              try {
                const found = await detector.detect(videoRef.current);
                if (found?.length && handle(found[0].rawValue)) return;
              } catch {}
            }

            // Automatic still capture. After a couple of seconds of live
            // decoding getting nowhere, the video stream is not going to
            // resolve this label — so grab a sharper still and decode that
            // instead of continuing to loop. Repeats every 2s, up to 4 tries,
            // which covers the user bringing the code into frame.
            // Auto attempts use their OWN flag, not the shared one. The manual
            // Capture button was gated on capturingRef, which this loop held for
            // the duration of each attempt — so pressing Capture during an auto
            // attempt returned silently and the button appeared dead.
            if (ts - started > 1500 && ts - lastStill > 2500 && stills < 4
                && !autoBusyRef.current && !capturingRef.current) {
              lastStill = ts;
              stills++;
              autoBusyRef.current = true;
              // No manual zoom slider: step the zoom in a little further with
              // each attempt so a small or distant barcode gets more sensor
              // detail on its own, the same way the live loop above does.
              stepZoom(stills);
              setMessage(`Looking harder (${stills}/4)…`);
              try {
                const code = await decodeStill(detector, await captureStill(), { fast: true, keepOnFail: false });
                if (code && handle(code)) return;
                if (stills >= 4) {
                  // No manual Capture button either — the last attempt runs
                  // the full-strength ladder itself instead of waiting for a press.
                  captureNowRef.current?.();
                } else {
                  setMessage("Reading — keep the barcode in frame.");
                }
              } catch { /* keep the live loop running */ }
              finally { autoBusyRef.current = false; }
            }

            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          captureNowRef.current = async () => {
            // No button triggers this anymore — the auto-escalation loop
            // above calls it once, after its own quick attempts stall. This
            // guard just stops it from overlapping itself.
            if (capturingRef.current) { setMessage("Already scanning that photo…"); return; }
            capturingRef.current = true;
            stills = 99;                     // stand the auto loop down, in case it is still running
            setMessage("Capturing — full scan, this takes a few seconds…");
            try {
              const bmp = await captureStill();
              const code = await decodeStill(detector, bmp, { fast: false, keepOnFail: false });
              if (code && handle(code)) return;

              // Last rung: the server pipeline, if one is configured. Only
              // reached after all twenty local strategies have failed.
              if (DECODE_URL) {
                setMessage("Sending to the decode service…");
                try {
                  const blob = await new Promise(res => {
                    const c = document.createElement("canvas");
                    c.width = bmp.width; c.height = bmp.height;
                    c.getContext("2d").drawImage(bmp, 0, 0);
                    c.toBlob(res, "image/jpeg", 0.9);
                  });
                  const r = await serverDecode(blob);
                  if (r?.code && handle(r.code)) return;
                  if (r?.digits) {
                    keepFailedShot(bmp);
                    setMessage(r.checksum_ok
                      ? `The bars were unreadable, but the service read ${r.digits} from the printed digits and the check digit validates. Confirm it below.`
                      : `The service read ${r.digits} from the printed digits, but the check digit does not validate — correct it below.`);
                    return;
                  }
                } catch (e) {
                  console.warn("serverDecode:", e);
                }
              }

              keepFailedShot(bmp);
              setMessage("No decoder could read that photo — the digits under the barcode can be typed below.");
            } catch (e) {
              setMessage("Capture failed: " + String(e?.message || e));
            } finally { capturingRef.current = false; }
          };
          return;
        } catch { /* fall through to ZXing */ }
      }

      try {
        const ZX = await loadZXing();
        if (stopRef.current) return;
        const reader = makeZXingReader(ZX);

        // Every iPhone (no BarcodeDetector at all) and Firefox lands here.
        // Plain continuous video decoding fights the same motion blur and
        // downscaled preview the native-detector branch above does — the
        // difference is that branch also escalates to a sharper still run
        // through the full enhancement ladder after a couple of seconds, and
        // this one previously did not, leaving readers with nothing between
        // "hope the live feed resolves it" and pressing Capture by hand. Same
        // escalation, same timing (first look at 1.5s, then every 2.5s, up to
        // 4 tries) — decodeStill with no native detector now runs ZXing over
        // the ladder itself instead of a single raw-frame attempt.
        let stills = 0, escalating = false;
        const scheduleEscalation = () => {
          if (stopRef.current || stills >= 4) return;
          zxEscalationTimer = setTimeout(async () => {
            if (stopRef.current) return;
            if (escalating || autoBusyRef.current || capturingRef.current) { scheduleEscalation(); return; }
            stills++; escalating = true; autoBusyRef.current = true;
            stepZoom(stills);
            setMessage(`Looking harder (${stills}/4)…`);
            try {
              const code = await decodeStill(null, await captureStill(), { fast: true, keepOnFail: false });
              if (code && handle(code)) return;
              if (stills >= 4) {
                captureNowRef.current?.();
              } else {
                setMessage("Reading — keep the barcode in frame.");
              }
            } catch { /* keep the live loop running */ }
            finally { escalating = false; autoBusyRef.current = false; scheduleEscalation(); }
          }, stills === 0 ? 1500 : 2500);
        };
        scheduleEscalation();

        zxingControls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) handle(result.getText());
        });

        // Capture now goes through the same full-strength ladder the native-
        // detector branch uses (contrast, rotations, crops, tiled sweep — all
        // run against ZXing here, not just this one raw frame), so a deliberate
        // press is as capable on iOS/Firefox as it already was on Chrome/Android.
        captureNowRef.current = async () => {
          if (capturingRef.current) { setMessage("Already scanning that photo…"); return; }
          capturingRef.current = true;
          stills = 99;   // stand the auto loop down; the user has taken over
          setMessage("Capturing — full scan, this takes a few seconds…");
          try {
            const bmp = await captureStill();
            const code = await decodeStill(null, bmp, { fast: false, keepOnFail: false });
            if (code && handle(code)) return;

            if (DECODE_URL) {
              setMessage("Sending to the decode service…");
              try {
                const blob = await new Promise(res => {
                  const c = document.createElement("canvas");
                  c.width = bmp.width; c.height = bmp.height;
                  c.getContext("2d").drawImage(bmp, 0, 0);
                  c.toBlob(res, "image/jpeg", 0.85);
                });
                const r = await serverDecode(blob);
                if (r?.code && handle(r.code)) return;
              } catch (e) { console.warn("serverDecode:", e); }
            }
            // This is now the only fallback left — no manual Capture button
            // to try again with. Without keepFailedShot, iOS/Firefox users
            // hit a dead end here: the message said "type the digits below"
            // but nothing below ever appeared for them to type into.
            keepFailedShot(bmp);
            setMessage("No decoder could read that capture — type the digits below instead.");
          } catch (e) {
            setMessage("Capture failed: " + String(e?.message || e));
          } finally { capturingRef.current = false; }
        };
      } catch {
        setStatus("error");
        setMessage("The barcode reader could not be loaded. Check your connection, or type the number instead.");
      }
    })();

    return stopAll;
  }, [onDetect]);

  function keepFailedShot(bitmap) {
    try {
      const c = document.createElement("canvas");
      // Downscale for display only — the decode already happened at full size.
      const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
      c.width = Math.round(bitmap.width * scale);
      c.height = Math.round(bitmap.height * scale);
      c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", 0.85);
      setFailedShot({ url, base64: url.split(",")[1] });
    } catch { /* display is a bonus, not a requirement */ }
  }

  // Decode a photo the user picked. Useful when the camera cannot hold focus,
  // when the product is no longer to hand, or for a photo taken earlier.
  async function decodeFile(file) {
    if (!file) return;
    setMessage("Reading the photo…");
    try {
      const bitmap = await createImageBitmap(file);
      let detector = detectorRef.current;
      if (!detector && "BarcodeDetector" in window) {
        detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS });
      }
      const found = await decodeLadder(bitmap, detector, (step) => setMessage(`Reading the photo — ${step}…`));
      const code = found?.code || null;
      if (!code) keepFailedShot(bitmap);

      const clean = String(code || "").replace(/\D/g, "");
      if (clean.length >= 8) { stopRef.current = true; onDetect(clean); return; }
      setMessage("No decoder could read that image — the digits under the barcode can be typed below instead.");
    } catch (e) {
      setMessage("Could not read that photo: " + String(e?.message || e));
    }
  }

  const applyZoom = async (z) => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    setZoom(z);
    try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch { /* unsupported */ }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torchOn }] }); setTorchOn(v => !v); } catch {}
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#000",zIndex:10000,display:"flex",flexDirection:"column"}}>
      <div style={{position:"relative",flex:1,overflow:"hidden"}}>
        <video ref={videoRef} muted playsInline style={{width:"100%",height:"100%",objectFit:"cover"}}/>

        {/* Aiming guide */}
        {status === "scanning" && (
          <>
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
              <div style={{width:"min(78vw,320px)",height:170,border:"2px solid rgba(255,255,255,0.9)",borderRadius:14,boxShadow:"0 0 0 100vmax rgba(0,0,0,0.45)"}}/>
            </div>
            {/* Live status, not a static label: with no Capture button left to
                press, this line is the only sign the automatic ladder above
                (live decode → auto stills → auto-zoom → full-strength scan)
                is doing anything at all. Without it, the screen looks frozen
                for the several seconds each escalation step actually takes. */}
            <div style={{position:"absolute",left:0,right:0,bottom:isMobile?24:32,textAlign:"center",color:"#fff",fontSize:13,textShadow:"0 1px 3px rgba(0,0,0,0.6)",padding:"0 24px"}}>
              {message || "Point the camera at the product barcode"}
            </div>
          </>
        )}

        {status === "starting" && (
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:13,gap:10}}>
            <span style={{display:"inline-block",width:14,height:14,border:"2px solid #fff",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>
            Starting the camera…
          </div>
        )}

        {status === "error" && (
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:28}}>
            <div style={{background:t.bg,borderRadius:14,padding:"22px 24px",maxWidth:360,textAlign:"center"}}>
              <div style={{fontSize:26,marginBottom:10}}>📷</div>
              <div style={{fontSize:13,color:t.text,lineHeight:1.65,marginBottom:16}}>{message}</div>
              <button onClick={onClose} style={{background:t.accent,border:"none",color:t.accentFg,padding:"10px 20px",borderRadius:9,cursor:"pointer",fontSize:13,fontWeight:600}}>Close</button>
            </div>
          </div>
        )}
      </div>

      {/* Last resort: the capture that no decoder could read, shown at size so
          the printed digits can be read off it. A person reading numerals is
          more reliable than any of the rungs above, and the image is already
          in hand — discarding it would have made the capture worthless. */}
      {failedShot && (
        <div style={{background:"#111",padding:"12px 16px",borderTop:"1px solid rgba(255,255,255,0.15)"}}>
          <div style={{fontSize:11,color:"#fff",fontWeight:600,marginBottom:6}}>
            Couldn’t decode this — type the number printed under the barcode
          </div>
          <img src={failedShot.url} alt="captured barcode"
            style={{width:"100%",maxHeight:150,objectFit:"contain",background:"#000",borderRadius:8,marginBottom:8}}/>
          {/* Offered before the manual field, because it saves typing 13 digits
              off a screen — but it fills the field rather than searching, so the
              reader still confirms. */}
          <button onClick={readDigitsFromShot} disabled={readState?.busy}
            style={{width:"100%",padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,marginBottom:8,
              background:"rgba(255,255,255,0.15)",color:"#fff",
              border:"1px solid rgba(255,255,255,0.35)",cursor:readState?.busy?"default":"pointer"}}>
            {readState?.busy ? (readState.step ? `${readState.step}…` : "Reading…") : "Read the number from the photo"}
          </button>

          {readState && !readState.busy && (
            <div style={{fontSize:10,lineHeight:1.6,marginBottom:8,
              color: readState.error ? "#ff9b9b" : readState.checksumOk ? "#9be7b4" : "#ffd08a"}}>
              {readState.error
                ? `Could not read it automatically (${readState.error}). Type the digits below.`
                : !readState.digits
                  ? `No digits were legible. ${readState.note} Type them below.`
                  : readState.checksumOk
                    ? `Read ${readState.digits} — the check digit validates, so this is very likely correct. Compare it with the pack, then search. ${readState.note || ""}`
                    : `Read ${readState.digits} — but the check digit does NOT validate, so at least one digit is misread. Correct it against the pack before searching. ${readState.note || ""}`}
            </div>
          )}

          <div style={{display:"flex",gap:8}}>
            <input value={typedCode} onChange={e => { setTypedCode(e.target.value.replace(/\D/g, "")); setReadState(null); }}
              inputMode="numeric" placeholder="e.g. 8901234567890" maxLength={14}
              style={{flex:1,boxSizing:"border-box",fontSize:14,padding:"10px 12px",borderRadius:8,
                border:"1px solid rgba(255,255,255,0.3)",background:"rgba(255,255,255,0.1)",color:"#fff",
                letterSpacing:"0.06em"}}/>
            <button onClick={() => { if (typedCode.length >= 8) { stopRef.current = true; onDetect(typedCode); } }}
              disabled={typedCode.length < 8}
              style={{background:typedCode.length>=8?"#fff":"rgba(255,255,255,0.15)",border:"none",
                color:typedCode.length>=8?"#000":"rgba(255,255,255,0.5)",padding:"10px 18px",borderRadius:8,
                cursor:typedCode.length>=8?"pointer":"default",fontSize:13,fontWeight:700}}>
              Search
            </button>
          </div>
          <button onClick={() => { setFailedShot(null); setTypedCode(""); setReadState(null); setMessage(""); }}
            style={{marginTop:8,background:"none",border:"none",color:"rgba(255,255,255,0.6)",
              fontSize:11,cursor:"pointer",padding:0,textDecoration:"underline"}}>
            Dismiss and keep scanning
          </button>
        </div>
      )}

      {/* No manual slider — the scanner steps its own zoom in when a fast
          decode isn't landing. This is a read-only heads-up, not a control. */}
      {zoomCaps && status === "scanning" && zoom > zoomCaps.min && (
        <div style={{background:"#000",padding:"6px 18px 0",fontSize:11,color:"rgba(255,255,255,0.75)",fontWeight:600}}>
          Auto-zoom {zoom.toFixed(1)}×
        </div>
      )}
      {trackInfo && status === "scanning" && (
        <div style={{background:"#000",padding:"6px 18px 0",fontSize:10,
                     color: trackInfo.downgraded ? "#ffb347" : "rgba(255,255,255,0.45)", lineHeight:1.5}}>
          Camera: {trackInfo.w}×{trackInfo.h} @ {trackInfo.fps}fps · focus {trackInfo.focus}
          {trackInfo.downgraded && " — your browser granted a low resolution, which is very likely the reason small barcodes fail here."}
        </div>
      )}
      {status === "scanning" && (
        <div style={{background:"#000",padding:"4px 18px 0",fontSize:10,color:"rgba(255,255,255,0.5)",lineHeight:1.5}}>
          Small barcode? Hold at 15–20 cm and keep steady — the camera zooms in on its own if it doesn't read right away. Closer than ~10 cm the lens cannot focus, so it blurs.
          Shiny or curved pack (bottles): turn the light OFF and tilt slightly — glare erases the bars faster than dimness does.
        </div>
      )}

      <div style={{padding:"14px 18px",background:"#000",display:"flex",gap:10,alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff",padding:"11px 16px",borderRadius:9,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancel</button>

        {/* No manual Capture button — the scanner takes its own full-strength
            still automatically once the live decode stalls (see the
            escalation loops above), so there is nothing left to press. */}
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; decodeFile(f); }}/>
        <button onClick={() => fileRef.current?.click()}
          style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff",padding:"11px 16px",borderRadius:9,cursor:"pointer",fontSize:13,fontWeight:600}}>
          Photo
        </button>
        {canTorch && (
          <button onClick={toggleTorch} style={{background:torchOn?"#fff":"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",color:torchOn?"#000":"#fff",padding:"11px 18px",borderRadius:9,cursor:"pointer",fontSize:13,fontWeight:600}}>
            {torchOn ? "Light on" : "Light"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── RESPONSIVE ────────────────────────────────────────────────────────────────
// Styles here are inline, which CSS media queries cannot reach, so breakpoints
// are tracked in JS instead and fed into the style objects.

export { BarcodeScanner };
