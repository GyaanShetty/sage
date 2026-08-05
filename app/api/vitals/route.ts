import { NextResponse } from "next/server";
import { modelKeyStatus, modelIdStatus, usageHistory } from "@/infrastructure/llm";
import { lastBackup } from "@/core/ops/backup";

export const dynamic = "force-dynamic";

/**
 * Is SAGE healthy, and is his data safe?
 *
 * Two questions that used to have no answer short of reading logs: how much AI
 * headroom is left today, and when the data was last copied somewhere it could
 * survive from. Key material never appears here — tails and counts only.
 */
export async function GET() {
  const [usage, backup] = await Promise.all([
    usageHistory(7).catch(() => []),
    lastBackup().catch(() => null),
  ]);

  const keys = modelKeyStatus();
  return NextResponse.json({
    ok: true,
    data: {
      keys,
      models: modelIdStatus(),
      healthyKeys: keys.filter((k) => k.healthy).length,
      usage,
      backup,
      backupConfigured: !!process.env.BACKUP_REPO,
    },
  });
}
