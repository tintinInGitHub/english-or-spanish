import Head from "next/head";
import React, { useEffect, useRef, useState } from "react";
import styles from "../styles/Home.module.css";
import { RtmChannel } from "agora-rtm-sdk";
import {
  ICameraVideoTrack,
  IRemoteVideoTrack,
  IAgoraRTCClient,
  IRemoteAudioTrack,
} from "agora-rtc-sdk-ng";
import GIF from 'gif.js';

type TCreateRoomResponse = {
  room: Room;
  rtcToken: string;
  rtmToken: string;
};

type TGetRandomRoomResponse = {
  rtcToken: string;
  rtmToken: string;
  rooms: Room[];
};

type Room = {
  _id: string;
  status: string;
};

type TMessage = {
  userId: string;
  message: string | undefined;
};

interface IExtendedRemoteVideoTrack extends IRemoteVideoTrack {
  getElement?: () => HTMLVideoElement; // Ensure it returns HTMLVideoElement
}

interface IExtendedCameraVideoTrack extends ICameraVideoTrack {
  getElement?: () => HTMLVideoElement; // Ensure it returns HTMLVideoElement
}

function createRoom(userId: string): Promise<TCreateRoomResponse> {
  return fetch(`/api/rooms?userId=${userId}`, {
    method: "POST",
  }).then((response) => response.json());
}

function getRandomRoom(userId: string): Promise<TGetRandomRoomResponse> {
  return fetch(`/api/rooms?userId=${userId}`).then((response) =>
    response.json()
  );
}

function setRoomToWaiting(roomId: string) {
  return fetch(`/api/rooms/${roomId}`, { method: "PUT" }).then((response) =>
    response.json()
  );
}

export const VideoPlayer = ({
  videoTrack,
  style,
}: {
  videoTrack: IExtendedRemoteVideoTrack | IExtendedCameraVideoTrack;
  style: React.CSSProperties;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const playerRef = ref.current;
    if (!videoTrack) return;
    if (!playerRef) return;

    videoTrack.play(playerRef);

    // Add getElement method to videoTrack
    (videoTrack as IExtendedRemoteVideoTrack | IExtendedCameraVideoTrack).getElement = () => playerRef?.querySelector('video') as HTMLVideoElement;

    return () => {
      videoTrack.stop();
    };
  }, [videoTrack]);

  return <div ref={ref} style={style}></div>;
};

async function connectToAgoraRtc(
  roomId: string,
  userId: string,
  onVideoConnect: (videoTrack: IExtendedRemoteVideoTrack) => void,
  onWebcamStart: (videoTrack: IExtendedCameraVideoTrack) => void,
  onAudioConnect: (audioTrack: IRemoteAudioTrack) => void,
  token: string
) {
  const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");

  const client = AgoraRTC.createClient({
    mode: "rtc",
    codec: "vp8",
  });

  await client.join(
    process.env.NEXT_PUBLIC_AGORA_APP_ID!,
    roomId,
    token,
    userId
  );

  client.on("user-published", (themUser, mediaType) => {
    client.subscribe(themUser, mediaType).then(() => {
      if (mediaType === "video") {
        const remoteVideoTrack = themUser.videoTrack as IExtendedRemoteVideoTrack;
        onVideoConnect(remoteVideoTrack);
        detectMotion(remoteVideoTrack, false, () => alert(`User ${themUser.uid} moved`));
      }
      if (mediaType === "audio") {
        onAudioConnect(themUser.audioTrack);
        themUser.audioTrack?.play();
      }
    });
  });

  const tracks = await AgoraRTC.createMicrophoneAndCameraTracks();
  const cameraTrack = tracks.find(track => track.trackMediaType === 'video') as IExtendedCameraVideoTrack;
  onWebcamStart(cameraTrack);
  detectMotion(cameraTrack, true, () => alert(`You moved`));
  await client.publish(tracks);

  return { tracks, client };
}

async function connectToAgoraRtm(
  roomId: string,
  userId: string,
  onMessage: (message: TMessage) => void,
  token: string
) {
  const { default: AgoraRTM } = await import("agora-rtm-sdk");
  const client = AgoraRTM.createInstance(process.env.NEXT_PUBLIC_AGORA_APP_ID!);
  await client.login({
    uid: userId,
    token,
  });
  const channel = await client.createChannel(roomId);
  await channel.join();
  channel.on("ChannelMessage", (message, userId) => {
    onMessage({
      userId,
      message: message.text,
    });
  });

  return {
    channel,
  };
}

export default function Home() {
  const [userId] = useState(parseInt(`${Math.random() * 1e6}`) + "");
  const [room, setRoom] = useState<Room | undefined>();
  const [messages, setMessages] = useState<TMessage[]>([]);
  const [input, setInput] = useState("");
  const [themVideo, setThemVideo] = useState<IRemoteVideoTrack>();
  const [myVideo, setMyVideo] = useState<ICameraVideoTrack>();
  const [themAudio, setThemAudio] = useState<IRemoteAudioTrack>();
  const channelRef = useRef<RtmChannel>();
  const rtcClientRef = useRef<IAgoraRTCClient>();
  const [gifUrl, setGifUrl] = useState<string | null>(null);

  function handleNextClick() {
    connectToARoom();
  }

  function handleStartChattingClicked() {
    connectToARoom();
  }

  async function handleSubmitMessage(e: React.FormEvent) {
    e.preventDefault();
    await channelRef.current?.sendMessage({
      text: input,
    });
    setMessages((cur) => [
      ...cur,
      {
        userId,
        message: input,
      },
    ]);
    setInput("");
  }

  async function connectToARoom() {
    setThemAudio(undefined);
    setThemVideo(undefined);
    setMyVideo(undefined);
    setMessages([]);

    if (channelRef.current) {
      await channelRef.current.leave();
    }

    if (rtcClientRef.current) {
      rtcClientRef.current.leave();
    }

    const { rooms, rtcToken, rtmToken } = await getRandomRoom(userId);

    if (room) {
      setRoomToWaiting(room._id);
    }

    if (rooms.length > 0) {
      setRoom(rooms[0]);
      const { channel } = await connectToAgoraRtm(
        rooms[0]._id,
        userId,
        (message: TMessage) => setMessages((cur) => [...cur, message]),
        rtmToken
      );
      channelRef.current = channel;

      const { tracks, client } = await connectToAgoraRtc(
        rooms[0]._id,
        userId,
        (themVideo: IRemoteVideoTrack) => setThemVideo(themVideo),
        (myVideo: ICameraVideoTrack) => setMyVideo(myVideo),
        (themAudio: IRemoteAudioTrack) => setThemAudio(themAudio),
        rtcToken
      );
      rtcClientRef.current = client;
    } else {
      const { room, rtcToken, rtmToken } = await createRoom(userId);
      setRoom(room);
      const { channel } = await connectToAgoraRtm(
        room._id,
        userId,
        (message: TMessage) => setMessages((cur) => [...cur, message]),
        rtmToken
      );
      channelRef.current = channel;

      const { tracks, client } = await connectToAgoraRtc(
        room._id,
        userId,
        (themVideo: IRemoteVideoTrack) => setThemVideo(themVideo),
        (myVideo: ICameraVideoTrack) => setMyVideo(myVideo),
        (themAudio: IRemoteAudioTrack) => setThemAudio(themAudio),
        rtcToken
      );
      rtcClientRef.current = client;
    }
  }

  function convertToYouThem(message: TMessage) {
    return message.userId === userId ? "You" : "Them";
  }

  return (
    <>
      <Head>
        <title>Create Next App</title>
        <meta name="description" content="Generated by create next app" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        {room ? (
          <>
            {room._id}
            <button onClick={handleNextClick}>next</button>
            <div className="chat-window">
              <div className="video-panel">
                <div className="video-stream">
                  {myVideo && (
                    <VideoPlayer
                      style={{ width: "100%", height: "100%" }}
                      videoTrack={myVideo}
                    />
                  )}
                </div>
                <div className="video-stream">
                  {themVideo && (
                    <VideoPlayer
                      style={{ width: "100%", height: "100%" }}
                      videoTrack={themVideo}
                    />
                  )}
                </div>
              </div>
              <GifDisplay gifUrl={gifUrl} />
              <div className="chat-panel">
                <ul>
                  {messages.map((message, idx) => (
                    <li key={idx}>
                      {convertToYouThem(message)} - {message.message}
                    </li>
                  ))}
                </ul>

                <form onSubmit={handleSubmitMessage}>
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  ></input>
                  <button>submit</button>
                </form>
              </div>
            </div>
          </>
        ) : (
          <>
            <button onClick={handleStartChattingClicked}>Start Chatting</button>
          </>
        )}
      </main>
    </>
  );
}

function detectMotion(
  videoTrack: IExtendedRemoteVideoTrack | IExtendedCameraVideoTrack,
  isLocal: boolean,
  callback: () => void
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    console.error('Failed to get canvas context');
    return;
  }

  const width = 649;
  const height = 480;
  canvas.width = width;
  canvas.height = height;
  let lastImageData: ImageData | null = null;
  let motionDetected = false;

  function checkForMotion() {
    if (!videoTrack || !videoTrack.getElement) return;

    const element = videoTrack.getElement();
    if (!element || !(element instanceof HTMLVideoElement)) {
      console.error('Expected HTMLVideoElement, got:', element);
      return;
    }

    context.drawImage(element, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);

    if (lastImageData) {
      const diff = getFrameDifference(imageData.data, lastImageData.data);
      if (diff > 7718920 && !motionDetected) { // Motion threshold
        motionDetected = true; // Prevent multiple alerts
        callback();
        if (isLocal) {
          console.log("Motion detected for local user.");
          startRecording(videoTrack as IExtendedCameraVideoTrack);
        } else {
          console.log("Motion detected for remote user.");
        }
      }
    }
    lastImageData = imageData;
  }

  // Check for motion every second
  setInterval(checkForMotion, 2000);
}

function getFrameDifference(data1: Uint8ClampedArray, data2: Uint8ClampedArray) {
  let diff = 0;
  for (let i = 0; i < data1.length; i += 4) {
    diff += Math.abs(data1[i] - data2[i]) +
            Math.abs(data1[i + 1] - data2[i + 1]) +
            Math.abs(data1[i + 2] - data2[i + 2]);
  }
  return diff;
}

let mediaRecorder: MediaRecorder;
let recordedChunks: Blob[] = [];

async function startRecording(videoTrack: IExtendedCameraVideoTrack) {
  const videoElement = videoTrack.getElement();
  if (!videoElement) {
    console.error("No video element found for recording.");
    return;
  }

  console.log("Starting recording...");

  const stream = videoElement.captureStream();
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

  mediaRecorder.ondataavailable = function(event) {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
      console.log("Data available:", event.data);
    }
  };

  mediaRecorder.onstop = generateGif;

  mediaRecorder.start();

  // Stop recording after 5 seconds
  setTimeout(() => {
    console.log("Stopping recording...");
    mediaRecorder.stop();
  }, 5000);
}

async function generateGif() {
  console.log("Generating GIF...");
  const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
  const videoUrl = URL.createObjectURL(videoBlob);
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;

  console.log("Video URL created:", videoUrl);

  video.addEventListener('loadeddata', () => {
    console.log("Video loaded, starting playback...");
    video.play().then(() => {
      const gif = new GIF({
        workers: 2,
        quality: 10
      });

      gif.on('finished', function(blob) {
        const gifUrl = URL.createObjectURL(blob);
        console.log("Generated GIF URL: ", gifUrl);
        displayGif(gifUrl);
      });

      video.addEventListener('timeupdate', function() {
        if (video.currentTime >= 5) {
          video.pause();
          gif.render();
        } else {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          gif.addFrame(canvas, { delay: 100 });
        }
      });
    });
  });

  video.addEventListener('error', (e) => {
    console.error("Error loading video:", e);
  });
}

function displayGif(url: string) {
  setGifUrl(url);
  console.log("Displaying GIF URL: ", url);
}

const GifDisplay = ({ gifUrl }: { gifUrl: string | null }) => {
  if (!gifUrl) return null;
  return (
    <div className="gif-display">
      <img src={gifUrl} alt="Recorded GIF" />
    </div>
  );
};
