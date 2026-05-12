"use client";

import React from "react";
import Image from "next/image";

interface FeatureCardProps {
  /**
   * Feature title
   */
  title: string;
  /**
   * Feature description
   */
  description: string;
  /**
   * Video URL (YouTube URL or local video path)
   */
  videoUrl: string;
}

export const FeatureCard: React.FC<FeatureCardProps> = ({
  title,
  description,
  videoUrl,
}) => {
  /**
   * Check if it's a local video path
   */
  const isLocalVideo = (url: string) => {
    return (
      url.startsWith("/") ||
      url.endsWith(".mp4") ||
      url.endsWith(".webm") ||
      url.endsWith(".mov")
    );
  };

  /**
   * Check if it's a GIF file
   */
  const isGif = (url: string) => {
    return url.toLowerCase().endsWith(".gif");
  };

  /**
   * Convert YouTube URL to embed format
   * Supports multiple YouTube URL formats including Shorts
   */
  const getYouTubeEmbedUrl = (url: string) => {
    if (!url) return "";

    // Handle YouTube Shorts format: youtube.com/shorts/VIDEO_ID or youtu.be/VIDEO_ID
    const shortsMatch = url.match(
      /(?:youtube\.com\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    );
    if (shortsMatch?.[1]) {
      const videoId = shortsMatch[1];
      return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}`;
    }

    // Handle standard YouTube URL format
    const regExp =
      /^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]{11}).*/;
    const match = url.match(regExp);
    const videoId =
      match && match[1] && match[1].length === 11 ? match[1] : null;
    if (!videoId) return "";

    // Return embed URL, autoplay and muted
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}`;
  };

  const isLocal = isLocalVideo(videoUrl);
  const isGifFile = isGif(videoUrl);
  const embedUrl = isLocal ? null : getYouTubeEmbedUrl(videoUrl);

  return (
    <div
      className="mt-0 bg-background-card p-8 border border-border-primary transition-colors flex flex-col md:flex-row gap-6 md:gap-6 justify-start items-start h-auto md:h-fit"
      style={{ borderRadius: "var(--radius-card-large)" }}
    >
      {/* Text area: responsive width (max 640px) in left/right mode, full width in top/bottom mode */}
      <div className="w-full md:flex-1 md:max-w-160 shrink-0 flex flex-col justify-center gap-0 pt-6">
        <h3 className="text-xl md:text-2xl font-semibold font-serif mb-2 text-foreground">
          {title}
        </h3>
        <p className="text-foreground-muted text-base leading-6 text-left">
          {description.split("<br/>").map((part, index, array) => (
            <React.Fragment key={index}>
              {part}
              {index < array.length - 1 && <br />}
            </React.Fragment>
          ))}
        </p>
      </div>
      {/* Video area: fills remaining space in left/right mode, 1:1 ratio in top/bottom mode */}
      <div className="w-full md:flex-1 shrink-0 md:h-full flex items-center justify-center">
        <div className="relative w-full h-64 md:h-full md:w-full rounded-lg overflow-hidden">
          {isGifFile ? (
            <Image
              src={videoUrl}
              alt={title}
              fill
              className="object-contain"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          ) : isLocal ? (
            <video
              className="absolute inset-0 w-full h-full object-cover"
              src={videoUrl}
              autoPlay
              muted
              loop
              playsInline
              controls={false}
            />
          ) : embedUrl ? (
            <iframe
              className="absolute inset-0 w-full h-full"
              src={embedUrl}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="absolute inset-0 bg-zinc-200 flex items-center justify-center text-foreground-muted">
              Video is loading...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
