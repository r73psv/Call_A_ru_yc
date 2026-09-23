/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ModelType = 'GigaChat:Lite' | 'GigaChat:Pro' | 'GigaChat:Max' | 'GigaChat:Ultra' | 'gemini' | 'gemini-lite' | 'openrouter' | 'routerai' | 'yandexgpt' | 'gigachat';

export type GigaChatModel = 'GigaChat:Lite' | 'GigaChat:Pro' | 'GigaChat:Max' | 'GigaChat:Ultra';

export type UserRole = 'admin' | 'manager' | 'operator' | 'viewer';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt?: string;
  lastLoginAt?: string;
  isActive: boolean;
  notes?: string;
}

export interface AuthSession {
  token: string;
  user: {
    id: string;
    username: string;
    name: string;
    role: UserRole;
  };
  createdAt: number;
  expiresAt: number;
}

export interface SystemCredentials {
  gigachatAuthKey?: string;
  gigachatModel?: GigaChatModel;
  gigachatScope?: string;
  yandexApiKey?: string;
  yandexFolderId?: string;
  yandexServiceAccountKeyFile?: string;
  yandexServiceAccountKeyJson?: string;

  // Yandex Object Storage (для аудиозаписей SpeechKit >= 1MB)
  yandexStorageBucket?: string;
  yandexStorageAccessKey?: string;
  yandexStorageSecretKey?: string;
  yandexStorageEndpoint?: string;
  yandexStorageRegion?: string;

  // S3 Timeweb / Внешнее хранилище (для резервной копии базы данных 152-ФЗ)
  s3Endpoint?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3BucketName?: string;
  s3KeyPrefix?: string;
  s3Region?: string;

  storeEncryptionKey?: string;
  megafonToken?: string;
  megafonLkLogin?: string;
  megafonLkPassword?: string;
  vkToken?: string;
  vkChatId?: string;
  yclientsUserToken?: string;
  yclientsPartnerToken?: string;
  yclientsSalonId?: string;
  adminPasswordHash?: string;
  adminPasswordSalt?: string;
}

export interface KeyFacts {
  is_dispute: boolean;
  dispute_reason: string | null;
  promises: string[];
  tone_client: 'нейтральный' | 'позитивный' | 'негативный' | 'недовольный' | 'агрессивный' | string;
  tone_manager: 'нейтральный' | 'позитивный' | 'негативный' | 'спокойный' | 'оборонительный' | string;
  call_outcome: 'запись' | 'консультация' | 'отказ' | 'перезвон' | 'успешно' | 'не успешно' | 'перенесён' | 'автоответчик' | string;
  client_issue?: string;
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface CallRecord {
  call_id: string;
  timestamp: string;
  duration_seconds: number;
  model_used: ModelType | GigaChatModel;
  transcript: string;
  summary: string;
  key_facts: KeyFacts;
  trigger_phrases: string[];
  recommendations: string[];
  operator_score: number | null;
  operator_comment: string;
  tokens_used?: TokenUsage;
  
  // Custom metadata for rich display
  client_name?: string;
  operator_name?: string;
  audio_url?: string;
  status: 'processing' | 'completed' | 'failed' | 'Success' | 'missed' | 'Cancel' | 'Busy' | 'NotAvailable' | 'NotAllowed' | 'NotFound' | 'transcription_failed' | 'analysis_failed';
  error_message?: string;

  // Connection type details
  type?: 'incoming' | 'outgoing';
  is_answered?: boolean;
  is_demo?: boolean;

  // 152-ФЗ Personal Data & Consent Details
  client_phone?: string;
  full_phone?: string;
  client_phone_masked?: string;
  consent_id?: string;
  consent_status?: 'active' | 'not_applicable' | 'revoked';
  consent_purposes?: string[];
  consent_method?: 'voice' | 'written' | 'digital';
  gigachat_model?: GigaChatModel;
  anonymized?: boolean;
  retry_count?: number;
  last_retry_at?: string;
  auto_retry_count?: number;
  
  // TTL Data
  audio_deleted?: boolean;
  audio_deleted_at?: string;
  content_deleted?: boolean;
  content_deleted_at?: string;

  // External integrations status
  sent_to_vk?: boolean;
  vk_sent_at?: string;
  sent_to_yclients?: boolean;
  yclients_sent_at?: string;
}

export interface ConsentRecord {
  consent_id: string;              // UUID
  client_phone_masked: string;     // "****1234"
  client_phone_hash: string;       // SHA-256 full phone number
  consent_date: string;            // ISO 8601
  consent_method: 'voice' | 'written' | 'digital';
  consent_source: 'auto' | 'manual';
  call_id_origin?: string;         // ID of the originating call
  consent_text_version: string;    // '1.0'
  purposes: string[];              // ['quality_control', 'ai_analysis', 'loyalty_program']
  data_categories: string[];       // ['phone', 'voice', 'call_content', 'name']
  third_party_sharing: boolean;
  status: 'active' | 'revoked' | 'not_applicable' | 'expired';
  revoked_date: string | null;
  retention_period_days: number;   // 90
  updated_at: string;              // ISO 8601
}

export interface AccessLogEntry {
  id?: string;
  timestamp: string;
  user: string;
  action: 'read' | 'write' | 'export' | 'delete' | 'reanalyze' | 'consent_grant' | 'consent_revoke';
  resource: string;
  ip: string;
}

export interface MegafonConfig {
  token: string;
  webhookUrl: string;
  autoImport: boolean;
  active: boolean;
  pollingEnabled?: boolean;
  pollingIntervalMinutes?: number;
  lastPollingTime?: string;
  lkLogin?: string;
  lkPassword?: string;
}

export interface VkConfig {
  token: string;
  chatId: string;
  enabled: boolean;
  template: string;
}

export interface YclientsConfig {
  userToken: string;
  partnerToken: string;
  salonId: string;
  enabled: boolean;
}

export interface SystemConfig {
  activeModel: ModelType | GigaChatModel;
  default_gigachat_model: GigaChatModel;
  megafon: MegafonConfig;
  vk: VkConfig;
  yclients: YclientsConfig;
  openrouter?: { apiKey: string; model?: string; active?: boolean };
  routerai?: { apiKey: string; model?: string; active?: boolean; endpointUrl?: string };
  yandexCloudConfigured?: boolean;
  gigachatConfigured?: boolean;
  encryptionActive?: boolean;
  credentials?: SystemCredentials;
  ttlSettings?: {
    audioDays: number;
    transcriptDays: number;
    fullDeleteDays: number;
    accessLogDays: number;
  };
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning';
  module: 'speechkit' | 'gigachat' | 'consent' | 'cleanup' | 'megafon' | 'vk' | 'yclients' | 'system' | 'security' | string;
  message: string;
  details?: string;
}

export interface DashboardStats {
  totalCalls: number;
  disputeRate: number;
  averageScore: number;
  successRate: number;
  totalConsents?: number;
  activeConsents?: number;
  loyaltyConsents?: number;
  toneStats: {
    client: { neutral: number; discontent: number; aggressive: number };
    manager: { neutral: number; calm: number; defensive: number };
  };
}

export interface AnalysisResult {
  transcript_summary: string;
  key_facts: {
    is_dispute: boolean;
    dispute_reason: string | null;
    tone_client: string;
    tone_manager: string;
    call_outcome: string;
    client_issue: string;
  };
  operator_score: number | null;
  operator_comment: string;
  recommendations: string | string[];
}
