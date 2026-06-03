import type { ComponentType, SVGProps } from "react";
import { AiScan } from "pixelarticons/react/AiScan";
import { Analytics } from "pixelarticons/react/Analytics";
import { AppWindows } from "pixelarticons/react/AppWindows";
import { ArrowRight } from "pixelarticons/react/ArrowRight";
import { Bookmark } from "pixelarticons/react/Bookmark";
import { Blocks } from "pixelarticons/react/Blocks";
import { Braces } from "pixelarticons/react/Braces";
import { Bulletlist } from "pixelarticons/react/Bulletlist";
import { Check } from "pixelarticons/react/Check";
import { Clock } from "pixelarticons/react/Clock";
import { Cloud } from "pixelarticons/react/Cloud";
import { Coins } from "pixelarticons/react/Coins";
import { CommentText } from "pixelarticons/react/CommentText";
import { Copy } from "pixelarticons/react/Copy";
import { CursorMinimal } from "pixelarticons/react/CursorMinimal";
import { Download } from "pixelarticons/react/Download";
import { GitPullRequest } from "pixelarticons/react/GitPullRequest";
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
  copy: Copy,
  cursor: CursorMinimal,
  device: Smartphone,
  devices: AppWindows,
  download: Download,
  gauge: Analytics,
  github: GitPullRequest,
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
