// Ajustes del cliente de IA.
//
// La clave tecleada es un borrador. Al guardar sale de esta pantalla y queda
// en el proceso. Desde aquí no se puede volver a leer.

import {
  DEFAULT_CONFIG,
  PROVIDER_ENDPOINTS,
  PROVIDER_LABELS,
  PROVIDER_MODEL_PRESETS,
  TOKEN_RANGE,
  configProblems,
  temperatureRange,
  describeConfig,
  withProvider,
} from "../ai/config";
import type { AiConfig, ModelInfo, ProviderId } from "../ai/types";

/** Orden estable de los proveedores en el selector. */
const PROVIDERS: ProviderId[] = ["anthropic", "openai"];

/** Ajusta un número a un rango, ignorando valores no finitos. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export default function AiSettings({
  config,
  models,
  status,
  busy,
  storeAvailable,
  onChange,
  onSave,
  onForget,
  onLoadModels,
  onClose,
}: {
  config: AiConfig;
  models: ModelInfo[];
  status: string | null;
  busy: boolean;
  storeAvailable: boolean;
  onChange: (config: AiConfig) => void;
  onSave: () => void;
  onForget: () => void;
  onLoadModels: () => void;
  onClose: () => void;
}) {
  const problems = configProblems(config);
  const presets = PROVIDER_MODEL_PRESETS[config.provider];
  const heat = temperatureRange(config.provider);

  return (
    <div className="ai-settings">
      <label className="ai-field">
        <span>Proveedor</span>
        <select
          value={config.provider}
          onChange={(event) => onChange(withProvider(config, event.target.value as ProviderId))}
        >
          {PROVIDERS.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_LABELS[id]}
            </option>
          ))}
        </select>
      </label>

      <label className="ai-field">
        <span>Modelo</span>
        <input
          list="ai-model-presets"
          spellCheck={false}
          value={config.model}
          onChange={(event) => onChange({ ...config, model: event.target.value })}
        />
        <datalist id="ai-model-presets">
          {presets.map((id) => (
            <option key={`preset-${id}`} value={id} />
          ))}
          {models.map((model) => (
            <option key={`live-${model.id}`} value={model.id} />
          ))}
        </datalist>
      </label>

      <label className="ai-field">
        <span>Clave de API</span>
        <input
          type="password"
          spellCheck={false}
          autoComplete="off"
          placeholder="sk-…"
          value={config.apiKey}
          onChange={(event) => onChange({ ...config, apiKey: event.target.value })}
        />
      </label>

      <div className="row">
        <button type="button" disabled={busy} onClick={onLoadModels}>
          listar modelos
        </button>
        <span className="grow" />
        <span className="muted">
          {config.hasKey
            ? config.rememberKey
              ? "clave en llavero"
              : "clave en esta sesión"
            : "sin clave"}
        </span>
      </div>

      <label className="ai-field">
        <span>Raíz de la API</span>
        <input
          spellCheck={false}
          value={config.baseUrl}
          placeholder={PROVIDER_ENDPOINTS[config.provider]}
          aria-label="Raíz de la API"
          onChange={(event) => onChange({ ...config, baseUrl: event.target.value })}
        />
        <span className="muted">
          Prefijo de la petición. Anthropic añade /messages; OpenAI y los servidores compatibles,
          /chat/completions.
        </span>
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            onChange({ ...config, baseUrl: PROVIDER_ENDPOINTS[config.provider] })
          }
        >
          raíz oficial
        </button>
      </div>

      <div className="ai-field-row">
        <label className="ai-field">
          <span>Máximo de tokens</span>
          <input
            type="number"
            min={TOKEN_RANGE.min}
            max={TOKEN_RANGE.max}
            step={64}
            value={config.maxTokens}
            onChange={(event) =>
              onChange({
                ...config,
                maxTokens: clamp(Number(event.target.value), TOKEN_RANGE.min, TOKEN_RANGE.max),
              })
            }
          />
        </label>
        <label className="ai-field">
          <span>Temperatura</span>
          <input
            type="number"
            min={heat.min}
            max={heat.max}
            step={0.1}
            placeholder="del proveedor"
            value={config.temperature === null ? "" : String(config.temperature)}
            onChange={(event) => {
              const raw = event.target.value.trim();
              onChange({
                ...config,
                temperature: raw === "" ? null : clamp(Number(raw), heat.min, heat.max),
              });
            }}
          />
        </label>
      </div>

      <label className="ai-check">
        <input
          type="checkbox"
          checked={config.rememberKey}
          onChange={(event) => onChange({ ...config, rememberKey: event.target.checked })}
        />
        <span>
          recordar la clave en el llavero de este equipo{" "}
          <span className="muted">
            (sin marcar, la clave vive sólo en esta sesión del proceso)
          </span>
        </span>
      </label>

      {config.provider === "openai" ? (
        <label className="ai-check">
          <input
            type="checkbox"
            checked={config.useMaxCompletionTokens}
            onChange={(event) =>
              onChange({ ...config, useMaxCompletionTokens: event.target.checked })
            }
          />
          <span>
            enviar <code className="inline-code">max_completion_tokens</code>{" "}
            <span className="muted">(modelos de razonamiento; desmarque para `max_tokens`)</span>
          </span>
        </label>
      ) : null}

      {problems.length > 0 ? (
        <ul className="ai-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <p className="muted">{describeConfig(config)}</p>
      {status ? <p className="muted">modelos: {status}</p> : null}
      {!storeAvailable ? (
        <p className="muted">
          El almacén del navegador no está disponible: los ajustes durarán sólo esta sesión.
        </p>
      ) : null}

      <div className="row">
        <button type="button" onClick={onSave}>
          Guardar
        </button>
        <button
          type="button"
          onClick={() => {
            onChange({ ...DEFAULT_CONFIG });
          }}
        >
          Valores de fábrica
        </button>
        <button type="button" onClick={onForget}>
          Olvidar
        </button>
        <span className="grow" />
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
