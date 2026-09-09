'use client';

import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useJellyfinPlaybackState, useJellyfinMediaMount } from './playback-provider';

const VideoStage = dynamic(() => import('./video-stage').then((module) => module.VideoStage));
const NowPlayingBar = dynamic(() => import('./now-playing-bar').then((module) => module.NowPlayingBar));

/** The media portal's container and element live for the authenticated app's
 * lifetime. Loading/unloading chrome never replaces the element or its ref. */
export function PlayerHost() {
  const { item } = useJellyfinPlaybackState();
  const mountMedia = useJellyfinMediaMount();
  const parking = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    const node = document.createElement('div');
    node.className = 'h-full w-full';
    parking.current?.appendChild(node);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM container cannot be created during server rendering
    setContainer(node);
    return () => node.remove();
  }, []);
  useEffect(() => {
    // Keep chrome mounted after first use; minimize, Stop and navigation retain
    // native fullscreen/PiP/media ownership until the app itself unmounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latch first user playback intent
    if (item) setActivated(true);
  }, [item]);
  return <>
    <div ref={parking} hidden aria-hidden="true" />
    {container && createPortal(<video ref={mountMedia} className="hpr-jf-video h-full w-full bg-black object-contain" playsInline preload="metadata" />, container)}
    {container && (activated || item) && <VideoStage mediaContainer={container} />}
    {(activated || item) && <NowPlayingBar />}
  </>;
}
