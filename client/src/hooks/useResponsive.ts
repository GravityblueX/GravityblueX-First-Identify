'use client';

import { useState, useEffect } from 'react';

interface BreakpointConfig {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  '2xl': number;
}

const defaultBreakpoints: BreakpointConfig = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

export function useResponsive(breakpoints: Partial<BreakpointConfig> = {}) {
  const bp = { ...defaultBreakpoints, ...breakpoints };
  
  const [screenSize, setScreenSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  useEffect(() => {
    const handleResize = () => {
      setScreenSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = screenSize.width < bp.md;
  const isTablet = screenSize.width >= bp.md && screenSize.width < bp.lg;
  const isDesktop = screenSize.width >= bp.lg;
  const isLargeDesktop = screenSize.width >= bp.xl;

  return {
    screenSize,
    isMobile,
    isTablet,
    isDesktop,
    isLargeDesktop,
    breakpoints: bp,
    // Responsive utilities
    cols: {
      mobile: 1,
      tablet: 2,
      desktop: isLargeDesktop ? 4 : 3,
    },
    padding: {
      mobile: 'p-4',
      tablet: 'p-6',
      desktop: 'p-8',
    },
    text: {
      mobile: 'text-sm',
      tablet: 'text-base',
      desktop: 'text-lg',
    }
  };
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}