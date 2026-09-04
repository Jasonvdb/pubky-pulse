"use client";

import { DetailRow } from "@/components/detail-row";
import { isWebEnvironment } from "@/lib/platforms";

interface DeviceDetailRowsProps {
  environment: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  /** Omitted by surfaces that carry no screen, such as metric events. */
  screenName?: string | null;
  buildNumber?: string | null;
  /** Filter the surrounding list by this row's screen / path. */
  onFilterScreen?: () => void;
}

/**
 * The device block of a detail sheet, labelled for where the event came from.
 *
 * A browser reports through the same three columns a phone does: `device_model`
 * is the browser and its major version ("Chrome 120"), `os_version` is the OS
 * name and version ("macOS 10.15.7"), and `screen_name` is the URL path. Calling
 * a browser a "Device Model" reads as a bug in the SDK, so the labels follow the
 * environment instead. `DetailRow` renders nothing for a null value, which is
 * how a web event — which has no build number — drops that row.
 */
export function DeviceDetailRows({
  environment,
  deviceModel,
  osVersion,
  screenName,
  buildNumber,
  onFilterScreen,
}: DeviceDetailRowsProps) {
  const isWeb = isWebEnvironment(environment);
  return (
    <>
      <DetailRow
        label={isWeb ? "Path" : "Screen Name"}
        value={screenName}
        onFilter={screenName ? onFilterScreen : undefined}
      />
      <DetailRow label={isWeb ? "Browser" : "Device Model"} value={deviceModel} />
      <DetailRow label={isWeb ? "OS" : "OS Version"} value={osVersion} />
      <DetailRow label="Build Number" value={buildNumber} />
    </>
  );
}
