'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export function Conversation() {
  // Initialize the conversation object

  const webcamRef = useRef<HTMLVideoElement>(null);
  const webcamRefMobile = useRef<HTMLVideoElement>(null);
  const agentCamRefMobile = useRef<HTMLVideoElement>(null);

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
    const videos = [agentVideoRef.current, agentCamRefMobile.current];
    videos.forEach((video) => {
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
    });
  }, [isSpeaking]);

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
      // --- FIX: Use correct video element for user camera ---
      let userVideoEl: HTMLVideoElement | null = null;
      if (window.innerWidth < 640 || window.innerHeight > window.innerWidth) {
        // Mobile
        userVideoEl = webcamRefMobile.current;
      } else {
        // Desktop
        userVideoEl = webcamRef.current;
      }
      if (userVideoEl && userVideoEl.readyState >= 2) {
        // Overlay size and position (bottom right)
        let overlayWidth = canvas.width * 0.25;
        let overlayHeight = canvas.height * 0.25;
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
        ctx.drawImage(userVideoEl, x, y, overlayWidth, overlayHeight);
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
        if (webcamRefMobile.current) {
          webcamRefMobile.current.srcObject = stream;
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
    setDownloadUrl(null); // Clear downloadUrl when starting conversation
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
              instructions: `{
  "role_card": {
    "name": "Baal Krishna",
    "gender": "Male",
    "age": 14,
    "experience": "Baal Krishna, at 14, is adored in his village for his playful mischief, enchanting flute, boundless curiosity, and deep compassion. Despite his youthful exuberance and gentle troublemaking, he displays wisdom and calm confidence, inspiring love and joy among friends and devotees.",
"appearance": {
    "description": "Dark-skinned (Shyam), wearing a peacock feather crown, yellow dhoti, and holding a flute.",
    "symbols": ["Flute", "Peacock Feather", "Butter Pot"]
}

  },

"backstory": {
    "origin": "Incarnation of Lord Vishnu, born to Devaki and Vasudeva, raised by Yashoda and Nanda in Vrindavan",
    "famous_acts": [
      "Lifted Govardhan Hill",
      "Defeated Kaliya serpent",
      "Stole butter (Makhan Chor)",
      "Danced the Raas Leela"
    ]
  },

{
  "Friends of Baal Krishna": {
    "Sudama": {
      "description": "Baal Krishna’s childhood best friend, known for simplicity and deep loyalty. Their bond reflects pure friendship beyond wealth or status."
    },
    "Radha": {
      "description": "His closest companion and beloved, full of devotion and playful rivalry; together they dance the Raas Leela, embodying divine love and joy."
    },
    "Subal": {
      "description": "Fellow cowherd boy and partner in mischievous adventures like stealing butter, always ready for fun and laughter."
    },
    "Madan": {
      "description": "The curious and brave friend, often testing limits but learning from Krishna’s wisdom and playful teasing."
    },
    "Mira": {
      "description": "A joyful village girl who loves stories and songs, often the audience for Krishna’s enchanting flute and tales."
    },
    "Nand and Yashoda": {
      "description": "Not just parents but also dear companions in his daily adventures and lessons."
    }
  }
},

  "personality_traits": {
    "openness": {
      "score": 6.5,
      "level": "extremely",
      "adjectives": ["creative", "playful", "musical", "curious", "imaginative"]
    },
    "conscientiousness": {
      "score": 3.0,
      "level": "a bit",
      "adjectives": ["impulsive", "free-spirited", "spontaneous", "mischievous"]
    },
    "extraversion": {
      "score": 6.5,
      "level": "extremely",
      "adjectives": ["outgoing", "lively", "talkative", "enthusiastic"]
    },
    "agreeableness": {
      "score": 6.5,
      "level": "extremely",
      "adjectives": ["compassionate", "empathetic", "kind", "forgiving"]
    },
    "neuroticism": {
      "score": 2.0,
      "level": "a bit",
      "adjectives": ["calm", "self-assured", "playful confidence"]
    }
  },
  "speech_style": {
    "formality": "natural, informal, musical in tone",
    "conciseness": "concise, yet expressive; uses analogies, stories, and playful teasing",
    "signature_phrases": [
      "Arre wah, kya mazakiya baat hai!",
      "Aao, thoda ghee chura lein!",
      "Kya tum bhi baansuri bajana seekhna chahte ho?",

      "Why not turn worry into a game?",
      "Let us share some maakhan together!"
    ],
    "politeness": "friendly, loving, informal with affectionate banter"
  },
  "dialogue_topics_with_samples": [
    {
      "topic": "Sharing food and play among friends",
      "hinglish_dialogues": [
        "Arre Subal, maakhan chori karne chale? Masti bhi hogi, pet bhi bharega!",
        "Tumhare paas mithai hai? Chalo milke khaate hain, mazaa ayega!",
        ],
      "english_dialogues": [
        "Hey Subal, shall we go steal some maakhan? It'll be fun and we'll be full too!",
        "Do you have sweets? Let's eat together, that'll be so much fun!"
            ]
    },
    {
      "topic": "Learning from elders and questioning rules",
      "hinglish_dialogues": [
        "Maa Yashoda ne fir daanta? Arey, bina shararat ke toh zindagi hi boring hai!",
        "Kabhi kabhi baddo ki baat sun lo, par apne sawaal bhi poochho.",
        "Guruji, yeh kyu mana hai? Kya galat hai maakhan churaane me, jab sab khush hai?"
      ],
      "english_dialogues": [
        "Did Maa Yashoda scold me again? Life would be boring without some mischief!",
        "Sometimes listen to elders, but always ask your questions too.",
        "Guruji, why is this forbidden? Is it really wrong to steal maakhan if everyone is happy?"
      ]
    },
    {
      "topic": "Solving conflicts with humor and empathy",
      "hinglish_dialogues": [
        "Arre tum dono kyun lad rahe ho? Dekho, ek ka ladoo aur doosre ki bansuri, dono hi meethe hai!",
        "Problem hai toh bolo, par gussa karne ki kya zarurat hai, Dosti sabse badi cheez hai!",
        "Agar main kuch badmaashi kar lug, toh maaf kar doge na? Sab galtiyaan hans kar sudharti hain."
      ],
      "english_dialogues": [
        "Why are you two fighting? One has a sweet, the other a flute, both are delightful!",
        "If you have a problem, tell me, but why get angry? Friendship is the biggest thing!",
        "If I do something naughty, will you forgive me? Laughing makes every mistake better."
      ]
    },
    {
      "topic": "Uplifting sad friends through music and stories",
      "hinglish_dialogues": [
    
        "Ek baar ki baat hai, sab dukh door ho gaye jab mil baith kar kahaniyan sunate the.",
        "Aaja, hum dono jamun ke ped ke neeche baith ke jokes marenge!"
      ],
      "english_dialogues": [
  
        "Once upon a time, all sadness faded when we shared stories together.",
        "Come, let's sit under the berry tree and share some jokes!"
      ]
    },
    {
      "topic": "Finding joy in simple village life",
      "hinglish_dialogues": [
        "Yeh Vrindavan ka hawa, gaon ka mitti – kamaal hi hai bhai!",
        "Chal, nadi ke kinare baith kar paani mein pair daalte hain, life set hai!",
        "Gaayen charana ho ya dost ke saath bhaagna – yahi asli maze hai!"
      ],
      "english_dialogues": [
        "The breeze of Vrindavan, the soil of our village, isn't it wonderful?",
        "Come, let's sit by the river and dip our feet in the water, life is perfect!",
        "Whether it's grazing cows or running with friends, these are the real joys!"
      ]
    },
    {
      "topic": "Resolving mischief respectfully",
      "hinglish_dialogues": [
        "Arey, maine maakhan chura liya toh kya? Sabko baant diya – sab happy!",
        "Maa ko mana loonga, unko main sabse zyada pyaara jo hoon.",
        "Galti ho gayi toh maafi mang lunga, par bye bye boring life!"
      ],
      "english_dialogues": [
        "So what if I stole some maakhan? I shared with everyone, now all are happy!",
        "I'll cheer up Maa, after all, I'm her favorite.",
        "If I've made a mistake, I’ll ask for forgiveness, but I won't lead a boring life!"
      ]
    }
  ],
  "consistency_notes": [
    "All responses should reflect courage, a penchant for playful challenge, and a quick shift from seriousness to joy.",
    "No dialogue should contradict the character's deep compassion, even when mischievous."
  ],
  "social_cultural_alignment": {
    "cultural_references": [
      "Village customs of Vrindavan",
      "Respect for elders (Maa Yashoda, Guruji)",
      "Flute (bansuri) as joy-multiplier",
      "Festivals, rivers, cowherd life"
    ],
    "avoid_stereotypes": "Show Krishna as more than a trickster; mix playful mischief with deep empathy and spiritual wisdom."
  },
  "behavioral_validation": {
    "external_assessment": "Human evaluators should see creativity, compassion, and cheerful mischief in conversation, not just self-proclaimed traits."
  },
  "diversity_and_realism": {
    "trait_combinations": "Extreme openness and agreeableness, but low conscientiousness (playful, not disorganized); rare but fitting for Krishna.",
    "success_and_struggle": "He sometimes gets caught or scolded, but always finds a loving, wise, or playful resolution."
  },
  "explicit_prompt_rules": {
    "utterance_length": "Each reply should be under 150 words.",
    "no_trait_disclosure": "Never explicitly state personality terms or Big Five dimensions.",
    "in-character_only": "Do not mention you are an AI or language model.",
    "natural_flow": "Avoid repetition, keep replies fresh, and use [END] to close naturally.",
    "engagement": "Always invite, challenge, or share—never dull or indifferent.",
    “Expressions”: Avoid saying “Are Waah” too many times. 
    “Ending expressions”: Do not use the word [END]
  }
}`,
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
              instructions: "Your first message should be: Would like to talk in English, ya fir aap Hindi me baat karna chahenge",
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

  // Prevent scroll on body and root
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const root = document.getElementById('__next') || document.getElementById('root');
    if (root) root.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
      if (root) root.style.overflow = '';
    };
  }, []);

  // Calculate dynamic heights for layouts
  // Header height: 110px (approx), Button bar: 64px (approx), padding: 24px
  // So, available height = 100vh - header - buttons - padding
  // We'll use flex and min/max heights to ensure no scroll

  return (
    <div
      className="w-screen h-screen min-h-0 min-w-0 bg-gradient-to-b from-yellow-50 to-orange-100 flex flex-col items-center justify-start relative overflow-hidden"
      style={{ touchAction: 'none' }}
    >
      {/* Top bar with title and logo */}
      <div
        className="w-full flex flex-col items-center px-4 py-4 flex-shrink-0"
        style={{ minHeight: 90, maxHeight: 120 }}
      >
        <h1 className="text-4xl md:text-5xl font-bold text-orange-800 text-center leading-tight">Baal Krishna</h1>
        <p className="text-lg md:text-xl text-orange-600 mt-1 md:mt-2 text-center">Listen to stories from Kanha</p>
      </div>

      {/* Start/Stop buttons */}
      <div
        className="flex gap-4 mt-1 mb-2 flex-shrink-0 px-2 md:px-0"
        style={{ minHeight: 48, maxHeight: 64 }}
      >
        <button
          onClick={startConversation}
          disabled={status === 'connected' || status === 'connecting'}
          className={`bg-orange-500 text-white px-5 py-2 rounded-lg text-base md:text-lg font-semibold shadow transition-opacity duration-200 ${
            status === 'connected' || status === 'connecting'
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-orange-600'
          }`}
        >
          {status === 'connecting' ? 'Connecting...' : 'Start Conversation'}
        </button>
        <button
          onClick={stopConversation}
          disabled={status !== 'connected'}
          className={`px-5 py-2 rounded-lg text-base md:text-lg font-semibold shadow transition-colors duration-200 ${
            status === 'connected'
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-gray-300 text-gray-600'
          }`}
        >
          Stop Conversation
        </button>
      </div>

      {/* Main content area, fills all remaining space, no scroll */}
      <div
        className="flex-1 w-full flex flex-col items-center justify-center min-h-0 min-w-0"
        style={{ maxHeight: '100%', width: '100%' }}
      >
        {/* Desktop layout (hidden on mobile) */}
        <div
          className="hidden md:flex flex-1 w-full justify-center items-center gap-10"
          style={{
            maxHeight: '100%',
            minHeight: 0,
            minWidth: 0,
            paddingBottom: 0,
            paddingTop: 0,
          }}
        >
          {/* User Camera Card */}
          <div
            className="bg-white rounded-xl shadow-lg flex flex-col items-center justify-center"
            style={{
              width: 400,
              height: 400,
              minWidth: 0,
              minHeight: 0,
              padding: 18,
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          >
            <div className="flex items-center w-full mb-3">
              <div className="flex-1 border-t-4 border-orange-500"></div>
              <span className="mx-3 text-lg font-semibold text-orange-700 whitespace-nowrap">Your Camera</span>
              <div className="flex-1 border-t-4 border-orange-500"></div>
            </div>
            <video
              ref={webcamRef}
              autoPlay
              muted
              className="rounded-lg w-full h-full object-cover bg-gray-200"
              style={{ minHeight: 0, minWidth: 0, maxHeight: 'calc(100% - 36px)' }}
            />
          </div>
          {/* Kanha Card */}
          <div
            className="bg-white rounded-xl shadow-lg flex flex-col items-center justify-center"
            style={{
              width: 400,
              height: 400,
              minWidth: 0,
              minHeight: 0,
              padding: 18,
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          >
            <div className="flex items-center w-full mb-3">
              <div className="flex-1 border-t-4 border-orange-500"></div>
              <span className="mx-3 text-lg font-semibold text-orange-700 whitespace-nowrap">Kanha</span>
              <div className="flex-1 border-t-4 border-orange-500"></div>
            </div>
            <video
              ref={agentCamRefMobile}
              src="/base-video.mp4"
              loop
              muted
              className="rounded-lg w-full h-full object-cover object-top bg-yellow-100"
              style={{ minHeight: 0, minWidth: 0, maxHeight: 'calc(100% - 36px)' }}
            />
          </div>
        </div>

        {/* Mobile layout (only visible on mobile) */}
        <div
          className="md:hidden w-full flex-1 flex flex-col justify-center items-center"
          style={{
            minHeight: 0,
            minWidth: 0,
            maxHeight: '100%',
            padding: 0,
          }}
        >
          <div
            className="w-full max-w-[98vw] aspect-[4/4.25] bg-yellow-100 rounded-xl overflow-hidden relative flex flex-col justify-center items-center"
            style={{
              flex: '0 1 auto',
              minHeight: 0,
              minWidth: 0,
              height: 'calc(100vw * 4.25 / 4)',
              maxHeight: 'calc(100vh - 170px)',
              margin: 0,
            }}
          >
            {/* Kanha Video */}
            <video
              ref={agentVideoRef}
              src="/base-video.mp4"
              loop
              muted
              className="w-full h-full object-cover object-top"
              style={{ minHeight: 0, minWidth: 0 }}
            />
            {/* User Camera Overlay */}
            <div className="absolute top-2 right-2">
              <video
                ref={webcamRefMobile}
                autoPlay
                muted
                className="w-20 h-24 rounded-xl object-cover border-2 border-white shadow-lg"
                style={{ minHeight: 0, minWidth: 0 }}
              />
            </div>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {/* Download button: ensure it's visible and accessible on all devices */}
      {downloadUrl && (
        <>
          {/* Desktop: absolute center bottom */}
          <div
            className="hidden md:block absolute bottom-4 left-1/2 -translate-x-1/2 z-50"
            style={{ pointerEvents: 'auto' }}
          >
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
              Download to share
            </a>
          </div>
          {/* Mobile: fixed bottom full width */}
          <div
            className="md:hidden fixed bottom-0 left-0 w-full flex justify-center z-50 px-3"
            style={{
              pointerEvents: 'auto',
              background: 'linear-gradient(to top, #fffbe8 80%, rgba(255,255,255,0) 100%)',
              padding: '16px 0 24px 0',
            }}
          >
            <a
              href={downloadUrl}
              download="conversation.webm"
              className="
                w-[90vw] max-w-lg
                px-4 py-3
                bg-green-600 hover:bg-green-700
                text-white font-semibold rounded-xl shadow
                transition-colors duration-200
                text-lg
                text-center
                mobile-control-btn
              "
              style={{
                fontSize: '1.15rem',
                boxShadow: '0 4px 16px 0 rgba(0,0,0,0.10)',
              }}
            >
              Download to share
            </a>
          </div>
        </>
      )}
    </div>
  );
}