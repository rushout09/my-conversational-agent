'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export function Conversation() {
  // Initialize the conversation object

  const webcamRef = useRef<HTMLVideoElement>(null);

  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentVideoRef = useRef<HTMLVideoElement>(null); // For agent video playback
  const agentAudioStreamRef = useRef<MediaStream | null>(null);

  // New state for OpenAI Realtime
  const [pc, setPc] = useState<RTCPeerConnection | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [isSpeaking, setIsSpeaking] = useState(false);

  // --- Play/pause agent video based on isSpeaking ---
  useEffect(() => {
    const video = agentVideoRef.current;
    if (!video) return;
    if (isSpeaking) {
      // Play if not already playing
      if (video.paused) {
        video.play().catch(() => {});
      }
    } else {
      // Pause and keep frame visible
      if (!video.paused) {
        video.pause();
      }
    }
  }, [isSpeaking]);
  // --------------------------------------------------

  const mixAudioStreams = useCallback(async (userStream: MediaStream, agentStream: MediaStream): Promise<MediaStream> => {
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    // User audio
    const userSource = audioContext.createMediaStreamSource(userStream);
    userSource.connect(destination);

    // Agent audio
    const agentSource = audioContext.createMediaStreamSource(agentStream);
    agentSource.connect(destination);

    return destination.stream;
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    // 1. Get user video/audio stream
    const userStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

    // 2. Get agent video element and remote audio stream
    const agentAudioStream = agentAudioStreamRef.current;
    if (!agentAudioStream) {
      alert("Agent audio not available yet!");
      return;
    }

    // 3. Set up canvas to combine videos
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;

    // Get agent video dimensions for aspect ratio
    let agentWidth = 1280;
    let agentHeight = 720;
    if (agentVideoRef.current) {
      agentWidth = agentVideoRef.current.videoWidth || agentWidth;
      agentHeight = agentVideoRef.current.videoHeight || agentHeight;
    }
    canvas.width = agentWidth;
    canvas.height = agentHeight;

    // Draw videos to canvas
    let animationFrameId: number;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw agent video at its natural aspect ratio, filling the canvas
      if (agentVideoRef.current && agentVideoRef.current.readyState >= 2) {
        ctx.drawImage(agentVideoRef.current, 0, 0, canvas.width, canvas.height);
      }
      // Draw user video as overlay in the corner (keep aspect ratio)
      if (webcamRef.current && webcamRef.current.readyState >= 2) {
        // Overlay size and position (bottom right)
        // Make overlay larger on mobile
        let overlayWidth = canvas.width * 0.25;
        let overlayHeight = canvas.height * 0.25;
        // If portrait (mobile), make overlay bigger
        if (window.innerWidth < 640 || window.innerHeight > window.innerWidth) {
          overlayWidth = canvas.width * 0.45;
          overlayHeight = canvas.height * 0.32;
        }
        const x = canvas.width - overlayWidth - 32;
        const y = canvas.height - overlayHeight - 32;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, overlayWidth, overlayHeight, 16);
        ctx.clip();
        ctx.drawImage(webcamRef.current, x, y, overlayWidth, overlayHeight);
        ctx.restore();
      }
      animationFrameId = requestAnimationFrame(draw);
    }
    draw();

    // 4. Get video stream from canvas
    const canvasStream = canvas.captureStream(30);

    // 5. Mix audio
    const mixedAudioStream = await mixAudioStreams(userStream, agentAudioStream);

    // 6. Combine video and audio
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...mixedAudioStream.getAudioTracks(),
    ]);

    // 7. Start MediaRecorder
    const localChunks: Blob[] = [];
    setRecordedChunks([]); // clear state before recording

    const mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm; codecs=vp9,opus' });
    setRecorder(mediaRecorder);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        localChunks.push(e.data);
        setRecordedChunks(prev => [...prev, e.data]);
      }
    };

    mediaRecorder.onstop = () => {
      // Cancel animation frame
      cancelAnimationFrame(animationFrameId);

      // Use localChunks to ensure we have all data
      const allChunks = localChunks.length > 0 ? localChunks : recordedChunks;
      if (allChunks.length === 0) {
        alert("No data was recorded.");
        setDownloadUrl(null);
        return;
      }
      const blob = new Blob(allChunks, { type: 'video/webm' });
      if (blob.size === 0) {
        alert("Recorded file is empty.");
        setDownloadUrl(null);
        return;
      }
      setDownloadUrl(URL.createObjectURL(blob));
      uploadRecording(blob).catch(console.error);
    };

    mediaRecorder.start(100); // Use timeslice to ensure ondataavailable is called periodically
  }, [mixAudioStreams, recordedChunks]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, [recorder]);

  // Get webcam stream
  useEffect(() => {
    let activeStream: MediaStream | null = null;
    async function enableWebcam() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        activeStream = stream;
        if (webcamRef.current) {
          webcamRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Error accessing webcam:', err);
      }
    }

    enableWebcam();

    return () => {
      // Clean up the stream on unmount
      activeStream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  async function uploadRecording(blob: Blob) {
    const formData = new FormData();
    formData.append('file', blob, 'conversation.webm');
  
    // Use fetch to POST to your API route
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: blob, // send raw blob, since API expects stream
      headers: {
        'Content-Type': 'video/webm',
      },
    });
  
    if (!res.ok) {
      throw new Error('Failed to upload');
    }
    return res.json();
  }

  // Modified: Start recording when starting conversation
  const startConversation = useCallback(async () => {
    setStatus('connecting');
    try {
      // Get ephemeral key
      const tokenResponse = await fetch("/api/session");
      const data = await tokenResponse.json();
      console.log("Session API response:", data);
      if (!data.client_secret || !data.client_secret.value) {
        alert("Failed to get session key from OpenAI. Please check your API key and try again.\nResponse: " + JSON.stringify(data));
        setStatus('disconnected');
        return;
      }
      const EPHEMERAL_KEY = data.client_secret.value;

      // Create peer connection
      const newPc = new RTCPeerConnection();

      // Play remote audio
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      newPc.ontrack = e => {
        audioEl.srcObject = e.streams[0];
        agentAudioStreamRef.current = e.streams[0];

        // Listen for silence to setIsSpeaking(false)
        if (audioEl.srcObject instanceof MediaStream) {
          const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const audioContext = new AudioContextClass();
          const source = audioContext.createMediaStreamSource(audioEl.srcObject);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);

          let silenceTimeout: NodeJS.Timeout | null = null;

          const checkSilence = () => {
            const data = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(data);

            // Calculate RMS (root mean square) to detect volume
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const val = (data[i] - 128) / 128;
              sum += val * val;
            }
            const rms = Math.sqrt(sum / data.length);

            if (rms < 0.02) { // Threshold for silence
              if (!silenceTimeout) {
                silenceTimeout = setTimeout(() => {
                  setIsSpeaking(false);
                }, 1000); // 1 second of silence
              }
            } else {
              if (silenceTimeout) {
                clearTimeout(silenceTimeout);
                silenceTimeout = null;
              }
              setIsSpeaking(true);
            }

            requestAnimationFrame(checkSilence);
          };

          checkSilence();
        }
      };

      // Add local audio track
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      newPc.addTrack(ms.getTracks()[0]);

      // Data channel for events
      const dc = newPc.createDataChannel("oai-events");
      dc.addEventListener("message", (e) => {
        // Parse the incoming message
        let msg;
        try {
          msg = JSON.parse(e.data);
          console.log(msg.type);
          console.log(msg);
        } catch (error) {
          console.error('Error parsing message:', error);
          return;
        }
        // Handle session.created event
        if (msg.type === "session.created") {
          // Send session.update with your configuration
          const updateEvent = {
            type: "session.update",
            session: {
              voice: "alloy",
              instructions: "Aapka naam krishna hai. Aap sirf Hindi mein baat karte hai. Aap ek jigyasi bande se baat kar rahe.",
              input_audio_noise_reduction: null,
              temperature: 0.8
            }
          };
          dc.send(JSON.stringify(updateEvent));
        }
        // Handle session.updated event
        if (msg.type === "session.updated") {
          console.log("Session updated:", msg.session);
          setStatus('connected');
          const initialMessage = {
            type: "response.create",
            response: {
              modalities: ["audio", "text"],
              instructions: "Aap balak se uska naam puch k conversation ki shurwat kijiye",
              max_output_tokens: 100
            }
          };
          dc.send(JSON.stringify(initialMessage));
        }
      });

      // SDP offer/answer
      const offer = await newPc.createOffer();
      await newPc.setLocalDescription(offer);

      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp"
        },
      });

      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: await sdpResponse.text(),
      };
      await newPc.setRemoteDescription(answer);

      setPc(newPc);

      // Start recording when session starts
      await startRecording();
    } catch (error) {
      setStatus('disconnected');
      console.error('Failed to start conversation:', error);
    }
  }, [startRecording]);

  // Modified: Stop recording when stopping conversation
  const stopConversation = useCallback(async () => {
    if (pc) {
      pc.close();
      setPc(null);
      setStatus('disconnected');
      setIsSpeaking(false);
      stopRecording();
    }
  }, [pc, stopRecording]);

  // --- Fullscreen, responsive, scalable overlays and agent video ---
  // Make sure the main container is non-scrollable and fits the viewport
  // Make user video and controls larger and higher on mobile
  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center w-screen h-screen overflow-hidden"
      style={{
        WebkitOverflowScrolling: 'auto',
        overscrollBehavior: 'none',
        maxHeight: '100dvh',
        height: '100dvh',
      }}
    >
      {/* Video area */}
      <div className="relative w-full h-full flex-1 flex items-center justify-center overflow-hidden">
        {/* Agent Video (main background, original aspect ratio, centered, responsive) */}
        <div className="absolute inset-0 flex items-center justify-center bg-black z-0">
          <video
            ref={agentVideoRef}
            src="/base-video.mp4"
            loop
            muted
            className="
              w-full h-full
              max-w-full max-h-full
              object-contain
              bg-black
              transition-all
              duration-300
            "
            style={{
              objectFit: 'contain',
              objectPosition: 'center',
              display: 'block',
              background: 'black',
              zIndex: 1,
            }}
          />
        </div>
        {/* User Video Overlay (bottom right corner, responsive, larger and higher on mobile) */}
        <video
          ref={webcamRef}
          autoPlay
          muted
          className="
            absolute
            rounded-lg shadow-lg border-4 border-white
            object-cover
            z-10
            transition-all
            duration-300
            right-[4vw]
            bottom-[4vw]
            w-[22vw] h-[16vw]
            min-w-[80px] min-h-[60px]
            max-w-[320px] max-h-[240px]
            sm:w-[18vw] sm:h-[13vw]
            md:w-[14vw] md:h-[10vw]
            lg:w-[12vw] lg:h-[9vw]
            xl:w-[10vw] xl:h-[7vw]
            mobile-user-video
          "
          style={{
            objectPosition: 'center 10%',
            display: 'block',
          }}
        />
        {/* Status indicator (responsive, bottom left, higher on mobile) */}
        <div
          className="
            absolute
            left-[4vw]
            bottom-[4vw]
            bg-black/60 text-white
            px-3 py-2
            sm:px-4 sm:py-2
            md:px-6 md:py-3
            rounded-lg
            text-sm sm:text-base md:text-lg
            font-medium shadow
            z-20
            transition-all
            duration-300
            mobile-status-indicator
          "
        >
          {status}
        </div>
        {/* Floating controls (responsive, bottom center, higher and larger on mobile) */}
        <div
          className="
            absolute
            left-1/2
            -translate-x-1/2
            flex flex-wrap gap-4
            z-20
            px-2
            bottom-[4vw]
            mobile-controls
          "
        >
          <button
            onClick={startConversation}
            disabled={status === 'connected' || status === 'connecting'}
            className="
              px-4 py-2
              sm:px-6 sm:py-3
              md:px-8 md:py-4
              bg-blue-600 text-white rounded-lg
              text-base sm:text-lg md:text-xl
              font-semibold shadow
              disabled:bg-gray-400
              transition
              mobile-control-btn
            "
          >
            Start
          </button>
          <button
            onClick={stopConversation}
            disabled={status !== 'connected'}
            className="
              px-4 py-2
              sm:px-6 sm:py-3
              md:px-8 md:py-4
              bg-red-600 text-white rounded-lg
              text-base sm:text-lg md:text-xl
              font-semibold shadow
              disabled:bg-gray-400
              transition
              mobile-control-btn
            "
          >
            Stop
          </button>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download="conversation.webm"
              className="
                px-4 py-2
                sm:px-6 sm:py-3
                md:px-8 md:py-4
                bg-green-600 hover:bg-green-700
                text-white font-semibold rounded-lg shadow
                transition-colors duration-200
                text-base sm:text-lg md:text-xl
                mobile-control-btn
              "
            >
              Download
            </a>
          )}
        </div>
      </div>
      {/* Hidden canvas for recording */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {/* Inline style for mobile adjustments */}
      <style>{`
        html, body {
          overscroll-behavior: none;
          height: 100dvh;
          max-height: 100dvh;
          overflow: hidden !important;
        }
        @media (max-width: 640px) {
          .mobile-user-video {
            width: 44vw !important;
            height: 32vw !important;
            min-width: 120px !important;
            min-height: 90px !important;
            max-width: 90vw !important;
            max-height: 40vw !important;
            right: 6vw !important;
            bottom: 18vw !important;
          }
          .mobile-status-indicator {
            left: 6vw !important;
            bottom: 18vw !important;
            font-size: 1.1rem !important;
            padding: 0.7rem 1.2rem !important;
          }
          .mobile-controls {
            bottom: 6vw !important;
          }
          .mobile-control-btn {
            font-size: 1.2rem !important;
            padding: 1.1rem 2.2rem !important;
          }
        }
      `}</style>
    </div>
  );
}