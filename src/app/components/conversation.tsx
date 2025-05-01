'use client';

import { useConversation } from '@11labs/react';
import { useCallback, useEffect, useRef, useState } from 'react';

export function Conversation() {
  const conversation = useConversation({
    onConnect: () => console.log('Connected'),
    onDisconnect: () => console.log('Disconnected'),
    onMessage: (message) => console.log('Message:', message),
    onError: (error) => console.error('Error:', error),
  });

  const webcamRef = useRef<HTMLVideoElement>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);

  // Get webcam stream
  useEffect(() => {
    async function enableWebcam() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (webcamRef.current) {
          webcamRef.current.srcObject = stream;
        }
        setWebcamStream(stream);
      } catch (err) {
        console.error('Error accessing webcam:', err);
      }
    }

    enableWebcam();

    return () => {
      // Clean up the stream on unmount
      webcamStream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const startConversation = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      await conversation.startSession({
        agentId: 'tp2ih3IGCDc2pctLH67x', // Replace with your agent ID
      });
    } catch (error) {
      console.error('Failed to start conversation:', error);
    }
  }, [conversation]);

  const stopConversation = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-2">
        <button
          onClick={startConversation}
          disabled={conversation.status === 'connected'}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
        >
          Start Conversation
        </button>
        <button
          onClick={stopConversation}
          disabled={conversation.status !== 'connected'}
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
          {conversation.isSpeaking ? (
            <video
              src="/base-video.mp4"
              autoPlay
              loop
              muted
              className="w-96 h-72 object-cover rounded"
              style={{ objectPosition: 'center 25%' }}
            />
          ) : (
            <img
              src="/base-image2.png"
              alt="Kanhaji"
              className="w-96 h-72 object-cover rounded"
              style={{ objectPosition: 'center 25%' }}
            />
          )}
        </div>
      </div>

      <div className="mt-4 text-center">
        <p>Status: {conversation.status}</p>
        <p>Agent is {conversation.isSpeaking ? 'speaking' : 'listening'}</p>
      </div>
    </div>
  );
}
