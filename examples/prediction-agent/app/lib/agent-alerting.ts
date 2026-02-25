import { config } from "./config";
import {
  getAgentMetricsSnapshot,
  type AgentMetricsSnapshot,
} from "./agent-metrics";

export type AgentAlertSeverity = "info" | "warning" | "critical";
export type AgentAlertStatus = "triggered" | "resolved";

export interface AgentAlertPolicy {
  enabled: boolean;
  cooldownSecs: number;
  actionWindow: number;
  minConsensusSamples: number;
  errorRateThreshold: number;
  consensusBlockRateThreshold: number;
  consensusClampRateThreshold: number;
  failoverEventsThreshold: number;
  heartbeatErrorsThreshold: number;
  quarantinedRegionsThreshold: number;
  requestTimeoutMs: number;
}

export interface AgentAlertChannels {
  webhookUrl?: string;
  slackWebhookUrl?: string;
  pagerDutyRoutingKey?: string;
  webhookMinSeverity: AgentAlertSeverity;
  slackMinSeverity: AgentAlertSeverity;
  pagerDutyMinSeverity: AgentAlertSeverity;
}

export interface AgentAlertRule {
  key: string;
  title: string;
  severity: AgentAlertSeverity;
  triggered: boolean;
  value: number;
  threshold: number;
  message: string;
}

export interface AgentAlertEvent extends AgentAlertRule {
  status: AgentAlertStatus;
  source: string;
  generatedAt: number;
}

export interface AgentAlertDispatchResult {
  enabled: boolean;
  source: string;
  sent: number;
  failed: number;
  triggered: number;
  resolved: number;
  errors: string[];
  events: AgentAlertEvent[];
}

type SendJsonFn = (
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number
) => Promise<void>;

interface AlertRuntimeState {
  active: boolean;
  lastNotifiedAt: number;
}

const ALERT_STATE = new Map<string, AlertRuntimeState>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toFixed(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

const defaultSendJson: SendJsonFn = async (url, body, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status} ${text}`.trim());
    }
  } finally {
    clearTimeout(timer);
  }
};

function severityToPagerDuty(severity: AgentAlertSeverity): string {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  return "info";
}

function severityRank(severity: AgentAlertSeverity): number {
  if (severity === "critical") return 2;
  if (severity === "warning") return 1;
  return 0;
}

function shouldRouteToChannel(
  eventSeverity: AgentAlertSeverity,
  minSeverity: AgentAlertSeverity
): boolean {
  return severityRank(eventSeverity) >= severityRank(minSeverity);
}

function buildPolicy(overrides?: Partial<AgentAlertPolicy>): AgentAlertPolicy {
  return {
    enabled: config.agentAlertingEnabled,
    cooldownSecs: config.agentAlertCooldownSecs,
    actionWindow: config.agentAlertActionWindow,
    minConsensusSamples: config.agentAlertMinConsensusSamples,
    errorRateThreshold: config.agentAlertErrorRateThreshold,
    consensusBlockRateThreshold: config.agentAlertConsensusBlockRateThreshold,
    consensusClampRateThreshold: config.agentAlertConsensusClampRateThreshold,
    failoverEventsThreshold: config.agentAlertFailoverEventsThreshold,
    heartbeatErrorsThreshold: config.agentAlertHeartbeatErrorsThreshold,
    quarantinedRegionsThreshold: config.agentAlertQuarantinedRegionsThreshold,
    requestTimeoutMs: config.agentAlertRequestTimeoutMs,
    ...(overrides ?? {}),
  };
}

function buildChannels(
  overrides?: Partial<AgentAlertChannels>
): AgentAlertChannels {
  return {
    webhookUrl: config.agentAlertWebhookUrl,
    slackWebhookUrl: config.agentAlertSlackWebhookUrl,
    pagerDutyRoutingKey: config.agentAlertPagerDutyRoutingKey,
    webhookMinSeverity: config.agentAlertWebhookMinSeverity,
    slackMinSeverity: config.agentAlertSlackMinSeverity,
    pagerDutyMinSeverity: config.agentAlertPagerDutyMinSeverity,
    ...(overrides ?? {}),
  };
}

export function resetAgentAlertState(): void {
  ALERT_STATE.clear();
}

export function evaluateMetricsAlertRules(args: {
  snapshot: AgentMetricsSnapshot;
  policy: AgentAlertPolicy;
}): AgentAlertRule[] {
  const { snapshot, policy } = args;
  const rules: AgentAlertRule[] = [];

  const errorRate = clamp(snapshot.actions.errorRate, 0, 1);
  rules.push({
    key: "error_rate_high",
    title: "Agent error rate elevated",
    severity:
      errorRate >= policy.errorRateThreshold * 1.5 ? "critical" : "warning",
    triggered: errorRate >= policy.errorRateThreshold,
    value: toFixed(errorRate),
    threshold: policy.errorRateThreshold,
    message:
      `Error rate ${formatPct(errorRate)} over window ${snapshot.actions.windowSize} ` +
      `(threshold ${formatPct(policy.errorRateThreshold)}).`,
  });

  const consensusSamples = snapshot.consensus.sampleCount;
  const blockRate =
    consensusSamples > 0
      ? snapshot.consensus.blockedCount / consensusSamples
      : 0;
  const clampRate =
    consensusSamples > 0
      ? snapshot.consensus.guardrailCounts.delta_clamped / consensusSamples
      : 0;
  const enoughConsensusSamples =
    consensusSamples >= policy.minConsensusSamples;

  rules.push({
    key: "consensus_block_rate_high",
    title: "Consensus block rate elevated",
    severity: "warning",
    triggered:
      enoughConsensusSamples &&
      blockRate >= policy.consensusBlockRateThreshold,
    value: toFixed(blockRate),
    threshold: policy.consensusBlockRateThreshold,
    message:
      `Consensus block rate ${formatPct(blockRate)} with ${consensusSamples} samples ` +
      `(threshold ${formatPct(policy.consensusBlockRateThreshold)}).`,
  });

  rules.push({
    key: "consensus_clamp_rate_high",
    title: "Consensus clamp rate elevated",
    severity: "warning",
    triggered:
      enoughConsensusSamples &&
      clampRate >= policy.consensusClampRateThreshold,
    value: toFixed(clampRate),
    threshold: policy.consensusClampRateThreshold,
    message:
      `Consensus clamp rate ${formatPct(clampRate)} with ${consensusSamples} samples ` +
      `(threshold ${formatPct(policy.consensusClampRateThreshold)}).`,
  });

  const failovers = snapshot.runtime.events.failedOver;
  rules.push({
    key: "runtime_failovers_spike",
    title: "Runtime failovers spiking",
    severity:
      failovers >= policy.failoverEventsThreshold * 2 ? "critical" : "warning",
    triggered: failovers >= policy.failoverEventsThreshold,
    value: failovers,
    threshold: policy.failoverEventsThreshold,
    message:
      `Runtime failovers ${failovers} in action window ` +
      `(threshold ${policy.failoverEventsThreshold}).`,
  });

  const heartbeatErrors = snapshot.runtime.events.heartbeatError;
  rules.push({
    key: "runtime_heartbeat_errors_spike",
    title: "Runtime heartbeat errors spiking",
    severity:
      heartbeatErrors >= policy.heartbeatErrorsThreshold * 2
        ? "critical"
        : "warning",
    triggered: heartbeatErrors >= policy.heartbeatErrorsThreshold,
    value: heartbeatErrors,
    threshold: policy.heartbeatErrorsThreshold,
    message:
      `Runtime heartbeat errors ${heartbeatErrors} in action window ` +
      `(threshold ${policy.heartbeatErrorsThreshold}).`,
  });

  const quarantinedRegions = snapshot.runtime.quarantinedRegionCount;
  rules.push({
    key: "runtime_quarantine_pressure",
    title: "Runtime region quarantine pressure",
    severity:
      quarantinedRegions >= policy.quarantinedRegionsThreshold * 2
        ? "critical"
        : "warning",
    triggered: quarantinedRegions >= policy.quarantinedRegionsThreshold,
    value: quarantinedRegions,
    threshold: policy.quarantinedRegionsThreshold,
    message:
      `Quarantined regions ${quarantinedRegions} ` +
      `(threshold ${policy.quarantinedRegionsThreshold}).`,
  });

  return rules;
}

async function sendToChannels(args: {
  event: AgentAlertEvent;
  channels: AgentAlertChannels;
  timeoutMs: number;
  sendJson: SendJsonFn;
}): Promise<{ sent: number; failed: number; errors: string[] }> {
  const { event, channels, timeoutMs, sendJson } = args;
  const errors: string[] = [];
  let sent = 0;
  let failed = 0;

  const summary =
    `[${event.status.toUpperCase()}][${event.severity.toUpperCase()}] ${event.title}`;

  if (
    channels.webhookUrl &&
    shouldRouteToChannel(event.severity, channels.webhookMinSeverity)
  ) {
    try {
      await sendJson(
        channels.webhookUrl,
        {
          type: "prediction_agent_metrics_alert",
          source: event.source,
          generatedAt: event.generatedAt,
          alert: {
            key: event.key,
            status: event.status,
            title: event.title,
            severity: event.severity,
            value: event.value,
            threshold: event.threshold,
            message: event.message,
          },
        },
        timeoutMs
      );
      sent += 1;
    } catch (err: any) {
      failed += 1;
      errors.push(`webhook: ${err?.message ?? String(err)}`);
    }
  }

  if (
    channels.slackWebhookUrl &&
    shouldRouteToChannel(event.severity, channels.slackMinSeverity)
  ) {
    const emoji = event.status === "resolved" ? ":white_check_mark:" : ":rotating_light:";
    try {
      await sendJson(
        channels.slackWebhookUrl,
        {
          text: `${emoji} ${summary}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text:
                  `${emoji} *${summary}*\n` +
                  `${event.message}\n` +
                  `Source: \`${event.source}\``,
              },
            },
          ],
        },
        timeoutMs
      );
      sent += 1;
    } catch (err: any) {
      failed += 1;
      errors.push(`slack: ${err?.message ?? String(err)}`);
    }
  }

  if (
    channels.pagerDutyRoutingKey &&
    shouldRouteToChannel(event.severity, channels.pagerDutyMinSeverity)
  ) {
    try {
      await sendJson(
        "https://events.pagerduty.com/v2/enqueue",
        {
          routing_key: channels.pagerDutyRoutingKey,
          event_action: event.status === "resolved" ? "resolve" : "trigger",
          dedup_key: `prediction-agent:${event.key}`,
          payload: {
            summary,
            source: event.source,
            severity: severityToPagerDuty(event.severity),
            timestamp: new Date(event.generatedAt).toISOString(),
            custom_details: {
              message: event.message,
              value: event.value,
              threshold: event.threshold,
              status: event.status,
            },
          },
        },
        timeoutMs
      );
      sent += 1;
    } catch (err: any) {
      failed += 1;
      errors.push(`pagerduty: ${err?.message ?? String(err)}`);
    }
  }

  return { sent, failed, errors };
}

export async function evaluateAndDispatchMetricAlerts(args?: {
  snapshot?: AgentMetricsSnapshot;
  source?: string;
  nowMs?: number;
  policy?: Partial<AgentAlertPolicy>;
  channels?: Partial<AgentAlertChannels>;
  sendJson?: SendJsonFn;
}): Promise<AgentAlertDispatchResult> {
  const source = args?.source ?? "agent-loop";
  const policy = buildPolicy(args?.policy);
  const channels = buildChannels(args?.channels);
  const sendJson = args?.sendJson ?? defaultSendJson;

  if (!policy.enabled) {
    return {
      enabled: false,
      source,
      sent: 0,
      failed: 0,
      triggered: 0,
      resolved: 0,
      errors: [],
      events: [],
    };
  }

  const snapshot =
    args?.snapshot ??
    getAgentMetricsSnapshot({ actionLimit: policy.actionWindow });
  const rules = evaluateMetricsAlertRules({ snapshot, policy });
  const cooldownMs = Math.max(0, policy.cooldownSecs) * 1000;
  const now = args?.nowMs ?? Date.now();

  let sent = 0;
  let failed = 0;
  let triggered = 0;
  let resolved = 0;
  const errors: string[] = [];
  const events: AgentAlertEvent[] = [];

  for (const rule of rules) {
    const state = ALERT_STATE.get(rule.key) ?? {
      active: false,
      lastNotifiedAt: 0,
    };

    let event: AgentAlertEvent | null = null;
    if (rule.triggered) {
      const shouldNotify =
        !state.active || now - state.lastNotifiedAt >= cooldownMs;
      if (shouldNotify) {
        event = {
          ...rule,
          status: "triggered",
          source,
          generatedAt: now,
        };
      }
      state.active = true;
    } else if (state.active) {
      event = {
        ...rule,
        status: "resolved",
        source,
        generatedAt: now,
      };
      state.active = false;
    }

    if (event) {
      const result = await sendToChannels({
        event,
        channels,
        timeoutMs: policy.requestTimeoutMs,
        sendJson,
      });
      sent += result.sent;
      failed += result.failed;
      errors.push(...result.errors);
      events.push(event);
      if (event.status === "triggered") triggered += 1;
      if (event.status === "resolved") resolved += 1;
      state.lastNotifiedAt = now;
    }

    ALERT_STATE.set(rule.key, state);
  }

  return {
    enabled: true,
    source,
    sent,
    failed,
    triggered,
    resolved,
    errors,
    events,
  };
}
