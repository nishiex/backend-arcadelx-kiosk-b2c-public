"use client"
import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

interface CountUpProps {
  to: number;
  from?: number;
  direction?: 'up' | 'down';
  delay?: number;
  duration?: number;
  className?: string;
  startWhen?: boolean;
  separator?: string;
  decimals?: number;
  decimal?: string;
  prefix?: string;
  suffix?: string;
}

export function CountUp({
  to,
  from = 0,
  direction = 'up',
  delay = 0,
  duration = 1.5,
  className = '',
  startWhen = true,
  separator = '',
  decimals = 0,
  decimal = '.',
  prefix = '',
  suffix = '',
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!startWhen || !ref.current) return;
    const node = ref.current;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      const formatNumber = (num: number) => {
        const value = num || 0;
        const parts = value.toFixed(decimals).split('.');
        parts[0] = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
        return parts.join(decimal);
      };
      node.textContent = `${prefix}${formatNumber(to)}${suffix}`;
      return;
    }

    const startValue = direction === 'up' ? from : to;
    const endValue = direction === 'up' ? to : from;
    const obj = { val: startValue };

    gsap.to(obj, {
      val: endValue,
      duration,
      delay,
      ease: 'power2.out',
      onUpdate: () => {
        if (node) {
          const num = obj.val || 0;
          const parts = num.toFixed(decimals).split('.');
          parts[0] = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
          node.textContent = `${prefix}${parts.join(decimal)}${suffix}`;
        }
      },
    });
  }, [to, from, direction, delay, duration, startWhen, separator, decimals, decimal, prefix, suffix]);

  return <span ref={ref} className={className} />;
}
