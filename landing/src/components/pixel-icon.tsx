import type { ComponentType, SVGProps } from "react";
import { AiScan } from "pixelarticons/react/AiScan";
import { Analytics } from "pixelarticons/react/Analytics";
import { ArrowRight } from "pixelarticons/react/ArrowRight";
import { Bookmark } from "pixelarticons/react/Bookmark";
import { Blocks } from "pixelarticons/react/Blocks";
import { Braces } from "pixelarticons/react/Braces";
import { Bulletlist } from "pixelarticons/react/Bulletlist";
import { Check } from "pixelarticons/react/Check";
import { Clock } from "pixelarticons/react/Clock";
import { Cloud } from "pixelarticons/react/Cloud";
import { Coins } from "pixelarticons/react/Coins";
import { CommentSharp } from "pixelarticons/react/CommentSharp";
import { CommentText } from "pixelarticons/react/CommentText";
import { Copy } from "pixelarticons/react/Copy";
import { CursorMinimal } from "pixelarticons/react/CursorMinimal";
import { Download } from "pixelarticons/react/Download";
import { Hand } from "pixelarticons/react/Hand";
import { HumanArmsDown } from "pixelarticons/react/HumanArmsDown";
import { Image } from "pixelarticons/react/Image";
import { Phone } from "pixelarticons/react/Phone";
import { Play } from "pixelarticons/react/Play";
import { Reload } from "pixelarticons/react/Reload";
import { Search } from "pixelarticons/react/Search";
import { Ship } from "pixelarticons/react/Ship";
import { Shuffle } from "pixelarticons/react/Shuffle";
import { Smartphone } from "pixelarticons/react/Smartphone";
import { Star } from "pixelarticons/react/Star";
import { Terminal } from "pixelarticons/react/Terminal";
import { Users } from "pixelarticons/react/Users";
import { Video } from "pixelarticons/react/Video";

import { cn } from "@/lib/utils";

export type PixelIconName =
  | "accessibility"
  | "arrow-right"
  | "bookmark-check"
  | "box-stack"
  | "braces"
  | "check"
  | "clock"
  | "cloud"
  | "coins"
  | "comment"
  | "comment-sharp"
  | "copy"
  | "cursor"
  | "device"
  | "devices"
  | "download"
  | "gauge"
  | "github"
  | "hand"
  | "handshake"
  | "list"
  | "phone"
  | "play"
  | "reload"
  | "run"
  | "search"
  | "ship"
  | "shuffle"
  | "snapshot"
  | "star"
  | "terminal"
  | "video";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

function FigmaDevicesIcon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {children}
      <path
        d="M3.33301 3.33301V11.667H10V6.66699H13.333V3.33301H3.33301ZM11.667 16.667H16.667V8.33301H11.667V16.667ZM15 15H13.333V13.333H15V15ZM8.33301 10H5V8.33301H8.33301V10ZM8.33301 6.66699H5V5H8.33301V6.66699ZM15 6.66699H18.333V18.333H10V13.333H1.66699V1.66699H15V6.66699Z"
        fill="currentColor"
      />
    </svg>
  );
}

function PixelGithubIcon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {children}
      <path d="M5 2H9V4H7V6H5V2Z" fill="currentColor" />
      <path d="M5 12H3V6H5V12Z" fill="currentColor" />
      <path d="M7 14H5V12H7V14Z" fill="currentColor" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9 16V14H7V16H3V14H1V16H3V18H7V22H9V18H11V16H9ZM9 16V18H7V16H9Z"
        fill="currentColor"
      />
      <path d="M15 4V6H9V4H15Z" fill="currentColor" />
      <path d="M19 6H17V4H15V2H19V6Z" fill="currentColor" />
      <path d="M19 12V6H21V12H19Z" fill="currentColor" />
      <path d="M17 14V12H19V14H17Z" fill="currentColor" />
      <path d="M15 16V14H17V16H15Z" fill="currentColor" />
      <path d="M15 18H13V16H15V18Z" fill="currentColor" />
      <path d="M15 18H17V22H15V18Z" fill="currentColor" />
    </svg>
  );
}

const iconComponents: Record<PixelIconName, IconComponent> = {
  accessibility: HumanArmsDown,
  "arrow-right": ArrowRight,
  "bookmark-check": Bookmark,
  "box-stack": Blocks,
  braces: Braces,
  check: Check,
  clock: Clock,
  cloud: Cloud,
  coins: Coins,
  comment: CommentText,
  "comment-sharp": CommentSharp,
  copy: Copy,
  cursor: CursorMinimal,
  device: Smartphone,
  devices: FigmaDevicesIcon,
  download: Download,
  gauge: Analytics,
  github: PixelGithubIcon,
  hand: Hand,
  handshake: Users,
  list: Bulletlist,
  phone: Phone,
  play: Play,
  reload: Reload,
  run: AiScan,
  search: Search,
  ship: Ship,
  shuffle: Shuffle,
  snapshot: Image,
  star: Star,
  terminal: Terminal,
  video: Video,
};

type PixelIconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: PixelIconName;
  title?: string;
};

export function PixelIcon({
  name,
  className,
  title,
  "aria-hidden": ariaHidden,
  ...props
}: PixelIconProps) {
  const Icon = iconComponents[name];
  const titleId = title ? `pixel-icon-${name}` : undefined;

  return (
    <Icon
      className={cn("inline-block shrink-0", className)}
      aria-hidden={ariaHidden ?? (title ? undefined : true)}
      aria-labelledby={titleId}
      role={title ? "img" : undefined}
      {...props}
    >
      {title ? <title id={titleId}>{title}</title> : null}
    </Icon>
  );
}
