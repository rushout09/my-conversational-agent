'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';

export function Conversation() {
  // Initialize the conversation object

  const webcamRef = useRef<HTMLVideoElement>(null);
  // Remove unused webcamStream state to fix lint error
  // const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);

  // New state for OpenAI Realtime
  const [pc, setPc] = useState<RTCPeerConnection | null>(null);
  // Removed unused dataChannel state
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [isSpeaking, setIsSpeaking] = useState(false);

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
        // setWebcamStream(stream); // Remove unused state update
      } catch (err) {
        console.error('Error accessing webcam:', err);
      }
    }

    enableWebcam();

    return () => {
      // Clean up the stream on unmount
      activeStream?.getTracks().forEach(track => track.stop());
    };
  }, []); // Intentionally omitting webcamStream from deps to avoid infinite loop

  const startConversation = useCallback(async () => {
    setStatus('connecting');
    try {
      // Get ephemeral key
      const tokenResponse = await fetch("/api/session");
      const data = await tokenResponse.json();
      const EPHEMERAL_KEY = data.client_secret.value;

      // Create peer connection
      const newPc = new RTCPeerConnection();

      // Play remote audio
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      newPc.ontrack = e => {
        audioEl.srcObject = e.streams[0];

        // Listen for silence to setIsSpeaking(false)
        if (audioEl.srcObject instanceof MediaStream) {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
              if (!isSpeaking) setIsSpeaking(true);
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
              input_audio_noise_reduction: null, // far_field if audio is from laptop mic, "near_field"  if audio is from headphones.
              temperature: 0.8
              // Add any other config fields as needed
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
              instructions: "Aap balak se uska naam puch k conversation ki shurwat kijiye", // Customize as needed
              max_output_tokens: 100
            }
          };
          dc.send(JSON.stringify(initialMessage));
        }
      });
      // No setDataChannel(dc) since dataChannel state is removed

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
    } catch (error) {
      setStatus('disconnected');
      console.error('Failed to start conversation:', error);
    }
  }, []);

  // Stop session
  const stopConversation = useCallback(async () => {
    if (pc) {
      pc.close();
      setPc(null);
      setStatus('disconnected');
      setIsSpeaking(false);
    }
  }, [pc]);
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-2">
        <button
          onClick={startConversation}
          disabled={status === 'connected' || status === 'connecting'}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
        >
          Start Conversation
        </button>
        <button
          onClick={stopConversation}
          disabled={status !== 'connected'}
          className="px-4 py-2 bg-red-500 text-white rounded disabled:bg-gray-300"
        >
          Stop Conversation
        </button>
      </div>

      <div className="flex gap-6 mt-8 flex-wrap justify-center">
        {/* User's Webcam */}
        <div className="border p-4">
          <p className="text-center mb-2 text-lg">Your Camera</p>
          <video
            ref={webcamRef}
            autoPlay
            muted
            className="w-96 h-72 object-cover rounded"
          />
        </div>

        {/* Agent Video or Image */}
        <div className="border p-4">
          <p className="text-center mb-2 text-lg">Agent</p>
          {isSpeaking ? (
            <video
              src="/base-video.mp4"
              autoPlay
              loop
              muted
              className="w-96 h-72 object-cover rounded"
              style={{ objectPosition: 'center 25%' }}
            />
          ) : (
            <Image
              src="/base-image2.png"
              alt="Kanhaji"
              width={384}
              height={288}
              className="w-96 h-72 object-cover rounded"
              style={{ objectPosition: 'center 25%' }}
              priority
            />
          )}
        </div>
      </div>

      <div className="mt-4 text-center">
        <p>Status: {status}</p>
      </div>
    </div>
  );
}