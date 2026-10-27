// Own line icons (24×24 grid, drawn for this project).
import type { ReactNode } from 'react'

const P = ({ children, size = 18, fill = false }: { children: ReactNode; size?: number; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

type I = { size?: number }

export const IconPhotoGrid = ({ size }: I) => (
  <P size={size}>
    <rect x="3" y="4" width="8" height="7" rx="1" />
    <rect x="13" y="4" width="8" height="4" rx="1" />
    <rect x="3" y="13" width="8" height="7" rx="1" />
    <rect x="13" y="10" width="8" height="10" rx="1" />
  </P>
)
export const IconSquareGrid = ({ size }: I) => (
  <P size={size}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
  </P>
)
export const IconDetail = ({ size }: I) => (
  <P size={size}>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 16l5-5 4 4 3-3 6 6" />
  </P>
)
export const IconCompare = ({ size }: I) => (
  <P size={size}>
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <path d="M12 3v18" />
  </P>
)
export const IconSliders = ({ size }: I) => (
  <P size={size}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </P>
)
export const IconCrop = ({ size }: I) => (
  <P size={size}>
    <path d="M7 3v14h14" />
    <path d="M3 7h14v14" />
  </P>
)
export const IconHeal = ({ size }: I) => (
  <P size={size}>
    <rect x="2.8" y="8.5" width="18.4" height="7" rx="3.5" transform="rotate(-45 12 12)" />
    <path d="M10.6 10.6h.01M13.4 13.4h.01M13.4 10.6h.01M10.6 13.4h.01" />
  </P>
)
export const IconMask = ({ size }: I) => (
  <P size={size}>
    <circle cx="12" cy="12" r="8.5" strokeDasharray="2.4 2.2" />
    <circle cx="12" cy="12" r="4" />
  </P>
)
export const IconEye = ({ size }: I) => (
  <P size={size}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </P>
)
export const IconEyeOff = ({ size }: I) => (
  <P size={size}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5c2 0 3.7.7 5.1 1.6M21.5 12s-3.5 6.5-9.5 6.5c-2 0-3.7-.7-5.1-1.6" />
    <path d="M4 20L20 4" />
  </P>
)
export const IconRedEye = ({ size }: I) => (
  <P size={size}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.6" fill="currentColor" />
  </P>
)
export const IconPresets = ({ size }: I) => (
  <P size={size}>
    <path d="M12 3l9 4.5-9 4.5-9-4.5z" />
    <path d="M3 12l9 4.5 9-4.5" />
    <path d="M3 16.5L12 21l9-4.5" />
  </P>
)
export const IconVersions = ({ size }: I) => (
  <P size={size}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3 4v4h4" />
    <path d="M12 8v4l3 2" />
  </P>
)
export const IconInfo = ({ size }: I) => (
  <P size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.01" />
  </P>
)
export const IconTag = ({ size }: I) => (
  <P size={size}>
    <path d="M3 12.5V4h8.5l9 9-8.5 8.5z" />
    <circle cx="7.5" cy="8.5" r="1.3" />
  </P>
)
export const IconPlus = ({ size }: I) => (
  <P size={size}>
    <path d="M12 5v14M5 12h14" />
  </P>
)
export const IconSearch = ({ size }: I) => (
  <P size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </P>
)
export const IconStar = ({ size = 14, filled }: I & { filled?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden>
    <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" />
  </svg>
)
export const IconFlag = ({ size }: I) => (
  <P size={size}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
  </P>
)
export const IconFlagFilled = ({ size }: I) => (
  <svg width={size ?? 18} height={size ?? 18} viewBox="0 0 24 24" aria-hidden>
    <path d="M5 21V4" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    <path d="M5 4h11l-2 4 2 4H5z" fill="currentColor" />
  </svg>
)
export const IconReject = ({ size }: I) => (
  <P size={size}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
    <path d="M15 15l5 5M20 15l-5 5" />
  </P>
)
export const IconRotateLeft = ({ size }: I) => (
  <P size={size}>
    <path d="M4 9a8 8 0 1 1 2 8" />
    <path d="M4 4v5h5" />
  </P>
)
export const IconRotateRight = ({ size }: I) => (
  <P size={size}>
    <path d="M20 9a8 8 0 1 0-2 8" />
    <path d="M20 4v5h-5" />
  </P>
)
export const IconFlipH = ({ size }: I) => (
  <P size={size}>
    <path d="M12 3v18" strokeDasharray="2 2" />
    <path d="M9 7L4 17h5zM15 7l5 10h-5z" />
  </P>
)
export const IconFlipV = ({ size }: I) => (
  <P size={size}>
    <path d="M3 12h18" strokeDasharray="2 2" />
    <path d="M7 9L17 4v5zM7 15l10 5v-5z" />
  </P>
)
export const IconChevron = ({ size = 14 }: I) => (
  <P size={size}>
    <path d="M6 9l6 6 6-6" />
  </P>
)
export const IconChevronRight = ({ size = 14 }: I) => (
  <P size={size}>
    <path d="M9 6l6 6-6 6" />
  </P>
)
export const IconClose = ({ size = 14 }: I) => (
  <P size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </P>
)
export const IconTrash = ({ size }: I) => (
  <P size={size}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </P>
)
export const IconAlbum = ({ size }: I) => (
  <P size={size}>
    <rect x="4" y="6" width="16" height="14" rx="1.5" />
    <path d="M7 3.5h10" />
  </P>
)
export const IconPhotos = ({ size }: I) => (
  <P size={size}>
    <rect x="3" y="5" width="15" height="12" rx="1.5" />
    <path d="M7 20h13a1 1 0 0 0 1-1V8" />
    <path d="M3 14l4-4 4 4 2-2 5 5" />
  </P>
)
export const IconClock = ({ size }: I) => (
  <P size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </P>
)
export const IconCalendar = ({ size }: I) => (
  <P size={size}>
    <rect x="3.5" y="5" width="17" height="15" rx="1.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </P>
)
export const IconEdited = ({ size = 12 }: I) => (
  <P size={size}>
    <path d="M4 20l4-1 11-11-3-3L5 16z" />
  </P>
)
export const IconUndo = ({ size }: I) => (
  <P size={size}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </P>
)
export const IconRedo = ({ size }: I) => (
  <P size={size}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </P>
)
export const IconShare = ({ size }: I) => (
  <P size={size}>
    <path d="M12 15V3M7.5 7.5L12 3l4.5 4.5" />
    <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
  </P>
)
export const IconDots = ({ size }: I) => (
  <P size={size}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />
  </P>
)
export const IconFilmstrip = ({ size }: I) => (
  <P size={size}>
    <rect x="3" y="7" width="18" height="10" rx="1" />
    <path d="M9 7v10M15 7v10" />
  </P>
)
export const IconWand = ({ size }: I) => (
  <P size={size}>
    <path d="M4 20L15 9" />
    <path d="M17 3v3M15.5 4.5h3M20 8v2M19 9h2M12 4v1.5" />
  </P>
)
export const IconPicker = ({ size }: I) => (
  <P size={size}>
    <path d="M14.5 5.5l4 4M4 20l1-4 9.5-9.5 3 3L8 19z" />
    <path d="M16 4l1.5-1.5a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2L20 8" />
  </P>
)
export const IconReset = ({ size }: I) => (
  <P size={size}>
    <path d="M4 12a8 8 0 1 0 2.3-5.7" />
    <path d="M4 4v4h4" />
  </P>
)
export const IconLeftPanel = ({ size }: I) => (
  <P size={size}>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M9 4v16" />
  </P>
)
export const IconGrid3 = ({ size }: I) => (
  <P size={size}>
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
  </P>
)
export const IconStraighten = ({ size }: I) => (
  <P size={size}>
    <path d="M3 17L21 9" />
    <path d="M3 20h18" strokeDasharray="2 2" />
  </P>
)
export const IconBrush = ({ size }: I) => (
  <P size={size}>
    <path d="M9.5 14.5L19 5a2 2 0 0 0-3-3l-9.5 9.5" />
    <path d="M6.5 11.5c-2 0-3.5 1.5-3.5 3.5 0 2-1 3-2 3.5 3 1.5 8 1 8-3.5" />
  </P>
)
export const IconLinear = ({ size }: I) => (
  <P size={size}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
    <path d="M3.5 9h17M3.5 15h17" strokeDasharray="2 2" />
    <path d="M3.5 12h17" />
  </P>
)
export const IconRadial = ({ size }: I) => (
  <P size={size}>
    <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
    <ellipse cx="12" cy="12" rx="5" ry="3.5" strokeDasharray="2 2" />
  </P>
)
export const IconPerson = ({ size }: I) => (
  <P size={size}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6" />
  </P>
)
export const IconSky = ({ size }: I) => (
  <P size={size}>
    <path d="M7 17h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 17z" />
  </P>
)
export const IconLayers = ({ size }: I) => (
  <P size={size}>
    <path d="M12 4l8 4-8 4-8-4z" />
    <path d="M4 12l8 4 8-4" />
  </P>
)
export const IconDroplet = ({ size }: I) => (
  <P size={size}>
    <path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z" />
  </P>
)
export const IconSun = ({ size }: I) => (
  <P size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </P>
)
