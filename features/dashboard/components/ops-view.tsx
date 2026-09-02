"use client";

import "../command.css";
import "../wall.css";
import { TileGuard } from "@/components/tile-guard";
import { CommuteTile } from "./commute-tile";
import { MemoryTile, ExamTile, SystemTile, SignalsTile } from "./page-tiles";
import { CommandsTile, ClocksTile } from "./wall-tiles";
import {
  SkillsTile, BudgetTile, DecisionsTile, WeatherWeekTile,
  MachineryTile, ModelLoadTile, KeysTile,
} from "./ops-tiles";

/**
 * Page two.
 *
 * Page one is the day — what is happening, what is owed, where he is. This is
 * the standing state underneath: the practice, the money, the machinery, and
 * the things page one had to drop to stay one screen.
 *
 * Nothing moved off page one to get here. That was the decision, and it is
 * the reason this file exists rather than a reshuffle of the first wall: a
 * dashboard you have learned the shape of stops being fast the moment things
 * change position.
 *
 * The panes that were removed from page one — Command Reference, System,
 * Memory — reappear here, where there is room for them and they are not
 * competing with the map.
 */
export function OpsView() {
  return (
    <div className="wall">
      <div className="wall-row wall2-r1">
        <TileGuard name="SKILLS"><SkillsTile n={41} /></TileGuard>
        <TileGuard name="BUDGET"><BudgetTile n={42} /></TileGuard>
        <TileGuard name="DECISIONS"><DecisionsTile n={43} /></TileGuard>
        <TileGuard name="MEMORY"><MemoryTile n={29} /></TileGuard>
      </div>

      <div className="wall-row wall2-r2">
        <TileGuard name="MODELLOAD"><ModelLoadTile n={46} /></TileGuard>
        <TileGuard name="MACHINERY"><MachineryTile n={45} /></TileGuard>
        <TileGuard name="KEYS"><KeysTile n={47} /></TileGuard>
        <TileGuard name="SIGNALS"><SignalsTile n={18} /></TileGuard>
      </div>

      <div className="wall-row wall2-r3">
        <TileGuard name="WEATHER"><WeatherWeekTile n={44} /></TileGuard>
        <TileGuard name="COMMUTE"><CommuteTile n={48} /></TileGuard>
        <TileGuard name="EXAMS"><ExamTile n={30} /></TileGuard>
        <TileGuard name="CLOCKS"><ClocksTile n={15} /></TileGuard>
        <TileGuard name="COMMANDS"><CommandsTile n={22} /></TileGuard>
        <TileGuard name="SYSTEM"><SystemTile n={23} /></TileGuard>
      </div>
    </div>
  );
}
