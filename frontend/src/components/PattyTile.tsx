import { LotRemarkBadge, type LotRemark } from "@/components/LotRemarkBadge";
import { pattyTitle, type PattyTile as Tile } from "@/utils/finishedPatty";

/**
 * One finished-patty tile: colour, which lot it came off, and how many patti are free.
 *
 * Shared between the Program screen's shelf and the Finished Patty page so a tile reads
 * identically in both — the page is the shelf with room to breathe, not a second design.
 */
export default function PattyTile({ tile, remarks, onPick }: {
  tile: Tile;
  remarks?: LotRemark[];
  onPick: (tile: Tile) => void;
}) {
  return (
    <button type="button" className="mm-patty-tile" title={pattyTitle(tile)} onClick={() => onPick(tile)}>
      <span className="mm-patty-tile-name">
        {tile.colour}
        {/* The tile is a button that programs this patty — read why the last run on it
            stopped before committing the next one. The remark is this LOT's, not every
            lot of the colour's. */}
        <LotRemarkBadge remarks={remarks} label={tile.colour} />
      </span>
      {/* Which material this is. Without it the shelf names a colour and the operator
          cannot tell two lots of it apart. */}
      <span className="mm-patty-tile-src">{tile.lotId || "no lot"}</span>
      <span className="mm-patty-tile-count">{tile.count}</span>
      <span className="mm-patty-tile-go" aria-hidden>→</span>
    </button>
  );
}
