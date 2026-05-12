"use client";

import { cn } from "@/lib/utils";
import React, { useMemo } from "react";

/**
 * OrbitingCircles component props
 */
interface OrbitingCirclesProps {
  /**
   * Child elements (icons)
   */
  children?: React.ReactNode;
  /**
   * Icon size
   */
  iconSize?: number;
  /**
   * Orbit radius
   */
  radius?: number;
  /**
   * Whether to rotate in reverse
   */
  reverse?: boolean;
  /**
   * Rotation speed (seconds)
   */
  speed?: number;
  /**
   * Delay time (seconds)
   */
  delay?: number;
  /**
   * Custom class name
   */
  className?: string;
  /**
   * Whether to show orbit dotted line
   */
  showOrbit?: boolean;
  /**
   * Orbit dotted line color
   */
  orbitColor?: string;
  /**
   * Whether to hide logo (for hover effect)
   */
  hideOnHover?: boolean;
}

/**
 * OrbitingCircles component
 * Makes child elements orbit around center
 */
export function OrbitingCircles({
  children,
  iconSize = 40,
  radius = 80,
  reverse = false,
  speed = 20,
  delay = 0,
  className,
  showOrbit = true,
  orbitColor = "var(--color-border-primary)",
  hideOnHover = false,
}: OrbitingCirclesProps) {
  // Convert children to array
  const childrenArray = useMemo(() => {
    return React.Children.toArray(children);
  }, [children]);

  // Calculate angle for each icon
  const angleStep = 360 / childrenArray.length;

  // Calculate orbit circle diameter (radius * 2)
  const orbitDiameter = radius * 2;

  return (
    <>
      {/* Orbit dotted circle - static, no rotation */}
      {showOrbit && (
        <svg
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-0"
          width={orbitDiameter}
          height={orbitDiameter}
          style={{
            overflow: "visible",
          }}
        >
          <circle
            cx={radius}
            cy={radius}
            r={radius}
            fill="none"
            stroke={orbitColor}
            strokeWidth="1.5"
            strokeDasharray="6 4"
            opacity="0.6"
          />
        </svg>
      )}

      {/* Rotation container - contains all icons */}
      <div
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          className,
        )}
        style={{
          width: `${orbitDiameter}px`,
          height: `${orbitDiameter}px`,
          animation: `orbit-${reverse ? "reverse" : "normal"} ${speed}s linear infinite`,
          animationDelay: `${delay}s`,
          transformOrigin: "center center",
        }}
      >
        {/* Icon */}
        {childrenArray.map((child, index) => {
          const angle = index * angleStep;
          const radian = (angle * Math.PI) / 180;
          const x = Math.cos(radian) * radius;
          const y = Math.sin(radian) * radius;

          return (
            <div
              key={index}
              className="absolute z-10"
              style={{
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div
                className={cn(
                  "relative flex items-center justify-center rounded-full bg-background-card border-2 border-border-primary shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)]",
                  hideOnHover ? "fade-out-logo" : "fade-in-logo",
                )}
                style={{
                  width: `${iconSize}px`,
                  height: `${iconSize}px`,
                }}
              >
                <div
                  style={{
                    width: `${iconSize * 0.6}px`,
                    height: `${iconSize * 0.6}px`,
                  }}
                  className="flex items-center justify-center"
                >
                  {child}
                </div>
                {/* Red circular badge - top right, with breathing animation */}
                <div
                  className={cn(
                    "absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-background-card z-20 breathe",
                    hideOnHover ? "fade-out-badge" : "fade-in-badge",
                  )}
                  style={{
                    minWidth: "12px",
                    minHeight: "12px",
                    backgroundColor: "rgb(239, 68, 68)", // red-500 initial color
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
