"use client";

import { useEffect, useRef, type HTMLAttributes } from "react";
import clsx from "clsx";

export type LiveWaveformProps = HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
  processing?: boolean;
  values?: number[];
  progress?: number;
  deviceId?: string;
  barWidth?: number;
  barHeight?: number;
  barGap?: number;
  barRadius?: number;
  barColor?: string;
  fadeEdges?: boolean;
  fadeWidth?: number;
  height?: string | number;
  sensitivity?: number;
  smoothingTimeConstant?: number;
  fftSize?: number;
  historySize?: number;
  updateRate?: number;
  mode?: "scrolling" | "static";
  onError?: (error: Error) => void;
  onStreamReady?: (stream: MediaStream) => void;
  onStreamEnd?: () => void;
};

function roundedBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  if (radius <= 0 || !ctx.roundRect) {
    ctx.fillRect(x, y, width, height);
    return;
  }

  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  ctx.fill();
}

export function LiveWaveform({
  active = false,
  processing = false,
  values,
  progress = 0,
  deviceId,
  barWidth = 3,
  barHeight: baseBarHeight = 4,
  barGap = 1,
  barRadius = 1.5,
  barColor,
  fadeEdges = true,
  fadeWidth = 24,
  height = 64,
  sensitivity = 1,
  smoothingTimeConstant = 0.8,
  fftSize = 256,
  historySize = 60,
  updateRate = 30,
  mode = "static",
  onError,
  onStreamReady,
  onStreamEnd,
  className,
  style,
  ...props
}: LiveWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barsRef = useRef<number[]>([]);
  const historyRef = useRef<number[]>([]);
  const animationRef = useRef<number>(0);
  const lastUpdateRef = useRef(0);
  const onErrorRef = useRef(onError);
  const onStreamReadyRef = useRef(onStreamReady);
  const onStreamEndRef = useRef(onStreamEnd);

  useEffect(() => {
    onErrorRef.current = onError;
    onStreamReadyRef.current = onStreamReady;
    onStreamEndRef.current = onStreamEnd;
  }, [onError, onStreamEnd, onStreamReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        onStreamEndRef.current?.();
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close();
      }
      audioContextRef.current = null;
      analyserRef.current = null;
      return;
    }

    let cancelled = false;
    const setup = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId
            ? {
                deviceId: { exact: deviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              }
            : {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) {
          throw new Error("Web Audio API is not available.");
        }

        const audioContext = new AudioContextCtor();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = smoothingTimeConstant;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        streamRef.current = stream;
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        historyRef.current = [];
        onStreamReadyRef.current?.(stream);
      } catch (error) {
        onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)));
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        onStreamEndRef.current?.();
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close();
      }
      audioContextRef.current = null;
      analyserRef.current = null;
    };
  }, [active, deviceId, fftSize, smoothingTimeConstant]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const animate = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const step = barWidth + barGap;
      const barCount = Math.max(1, Math.floor(rect.width / step));
      const values = mode === "scrolling" ? historyRef.current : barsRef.current;

      if (active && analyserRef.current && time - lastUpdateRef.current >= updateRate) {
        lastUpdateRef.current = time;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const start = Math.floor(data.length * 0.05);
        const end = Math.max(start + 1, Math.floor(data.length * 0.4));
        const slice = data.slice(start, end);

        if (mode === "scrolling") {
          const average = slice.reduce((sum, value) => sum + value, 0) / Math.max(1, slice.length);
          historyRef.current = [...historyRef.current, Math.max(0.05, Math.min(1, (average / 255) * sensitivity))].slice(-historySize);
        } else {
          const half = Math.max(1, Math.floor(barCount / 2));
          const next: number[] = [];
          for (let index = half - 1; index >= 0; index -= 1) {
            const dataIndex = Math.floor((index / half) * slice.length);
            next.push(Math.max(0.05, Math.min(1, ((slice[dataIndex] || 0) / 255) * sensitivity)));
          }
          for (let index = 0; index < half; index += 1) {
            const dataIndex = Math.floor((index / half) * slice.length);
            next.push(Math.max(0.05, Math.min(1, ((slice[dataIndex] || 0) / 255) * sensitivity)));
          }
          barsRef.current = next;
        }
      } else if (!active && values?.length) {
        const next = Array.from({ length: barCount }, (_, index) => {
          const sourceIndex = Math.floor((index / Math.max(1, barCount - 1)) * (values.length - 1));
          return Math.max(0.05, Math.min(1, values[sourceIndex] || 0.05));
        });
        if (mode === "scrolling") historyRef.current = next;
        else barsRef.current = next;
      } else if (processing && !active) {
        const next = Array.from({ length: barCount }, (_, index) => {
          const center = 1 - Math.abs(index - barCount / 2) / Math.max(1, barCount / 2);
          return Math.max(0.08, Math.min(1, 0.2 + center * 0.4 + Math.sin(time / 260 + index * 0.42) * 0.18));
        });
        if (mode === "scrolling") historyRef.current = next;
        else barsRef.current = next;
      } else if (!active) {
        barsRef.current = barsRef.current.map((value) => value * 0.92).filter((value) => value > 0.04);
        historyRef.current = historyRef.current.map((value) => value * 0.92).filter((value) => value > 0.04);
      }

      ctx.clearRect(0, 0, rect.width, rect.height);
      const renderedValues = mode === "scrolling" ? historyRef.current : barsRef.current;
      const color = barColor || getComputedStyle(canvas).color || "#ffffff";
      const centerY = rect.height / 2;

      renderedValues.slice(-barCount).forEach((value, index, visibleValues) => {
        const x = mode === "scrolling" ? rect.width - (visibleValues.length - index) * step : index * step;
        const renderedHeight = Math.max(baseBarHeight, value * rect.height * 0.82);
        ctx.fillStyle = color;
        const ratio = visibleValues.length <= 1 ? 1 : index / (visibleValues.length - 1);
        const played = !active && values?.length ? ratio <= progress : true;
        ctx.globalAlpha = (played ? 0.36 : 0.16) + value * (played ? 0.64 : 0.24);
        roundedBar(ctx, x, centerY - renderedHeight / 2, barWidth, renderedHeight, barRadius);
      });

      if (fadeEdges && fadeWidth > 0 && rect.width > 0) {
        const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
        const fade = Math.min(0.3, fadeWidth / rect.width);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(fade, "rgba(255,255,255,0)");
        gradient.addColorStop(1 - fade, "rgba(255,255,255,0)");
        gradient.addColorStop(1, "rgba(255,255,255,1)");
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, rect.width, rect.height);
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.globalAlpha = 1;
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [active, barColor, barGap, barRadius, barWidth, baseBarHeight, fadeEdges, fadeWidth, historySize, mode, processing, progress, sensitivity, updateRate, values]);

  return (
    <div
      ref={containerRef}
      className={clsx("live-waveform", className)}
      style={{ ...style, height: typeof height === "number" ? `${height}px` : height }}
      role="img"
      aria-label={active ? "Live audio waveform" : processing ? "Processing audio" : "Audio waveform idle"}
      {...props}
    >
      {!active && !processing ? <span className="live-waveform-idle" aria-hidden="true" /> : null}
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
