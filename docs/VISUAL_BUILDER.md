# Constructor visual (*Visual Builder*) — contrato del lienzo

Panel **«lienzo visual»** de la barra superior del IDE: se edita un **lienzo
JSON** de bloques conectados y el **kernel** lo valida, lo traduce a *Shoresh* y
lo **firma**. Este documento describe el contrato tal y como lo aplica el núcleo
(`BAR/src/visual_builder.rs`); la interfaz no añade ni una regla propia.

## 1. Una sola dirección, cero duplicación

```
web/src/components/VisualBuilder.tsx   editor, disco de la retícula, informe y composición
        │  invoke (IPC)
        ▼
web/src/visual.ts                      contrato TypeScript (camelCase) del panel
        │
        ▼
src-tauri/src/lib.rs                   visual_catalogue · visual_sample · visual_build · visual_compose
        │
        ▼
src/visual.rs                          proyección plana + sello con la clave del IDE
        │  bara::visual_builder
        ▼
BAR/src/visual_builder.rs              contrato estricto → AST Shoresh → ADN firmado
```

Ninguna capa reinterpreta lo que devuelve la anterior: si el kernel no publica un
AST, la interfaz muestra el error en lugar de un lienzo a medias.

## 2. Entrada: el lienzo

Raíz del documento (`ROOT_KEYS`):

| Clave | Tipo | Regla |
| --- | --- | --- |
| `module` | string | **Obligatoria**. `[A-Za-z0-9_-]{1,64}` |
| `label` | string | Opcional (por defecto, `module`); no puede quedar vacía. Es la etiqueta que se **firma** |
| `blocks` | array | **Obligatoria**. De 1 a `MAX_BLOCKS` (256) bloques |

Bloque (`BLOCK_KEYS`):

| Clave | Tipo | Regla |
| --- | --- | --- |
| `id` | string | **Obligatoria** y **única**. `[A-Za-z0-9_-]{1,64}` |
| `name` | string | **Obligatoria**, no vacía. Nombre visible del bloque |
| `kind` | string | **Obligatoria**. `source` · `transform` · `guard` · `sink` (§3) |
| `arity` | entero | **Obligatoria**. 0…256, sin parte fraccionaria |
| `ret` | string | **Obligatoria**. Tipo de retorno (§4) |
| `hazard` | número | **Obligatoria**. Riesgo declarado, `0 ≤ hazard ≤ 1` |
| `inputs` | array | Opcional (por defecto, vacío). Una ranura por entrada |
| `root` | string | Opcional. Raíz triconsonántica explícita (p. ej. `ברא`); si falta se deriva del `name` |

Ranura de entrada (`SLOT_KEYS`):

| Clave | Tipo | Regla |
| --- | --- | --- |
| `index` | entero | **Obligatoria**. Índice de un bloque **anterior** (`index <` posición del bloque) |
| `type` | string | Opcional (por defecto, `unknown`). Tipo esperado del productor (§4) |

## 3. Clases de bloque

| `kind` | Etiqueta | Reglas | Efecto |
| --- | --- | --- | --- |
| `source` | fuente | `arity = 0` **y** sin `inputs` | Abre una cadena: trae un valor de fuera |
| `transform` | transformación | `inputs.len() = arity` | Consume entradas y produce salida |
| `guard` | guarda | Igual que `transform` | Además el nodo **nace sellado** y el guion emite `שמר` |
| `sink` | sumidero | Igual que `transform` | El guion emite `אמר` al cerrar el programa |

La correspondencia `kind` ↔ nombre canónico la publica el propio kernel
(`BlockKind::{name, from_name, label, forces_seal}`): el IDE consume
`visual_catalogue` y no repite los cuatro literales.

## 4. Tipos (`ret`, `type`)

Mapa **exacto** (no heurístico): cada nombre resuelve a un único `BaraType`, y un
tipo mal escrito **invalida** el lienzo en vez de degradarse a `unknown`.

| Nombre | Hebreo |
| --- | --- |
| `number` | `מספר` |
| `text` | `מלים` |
| `void` | `אין` |
| `truth` | `אמת` |
| `list` | `רשימה` |
| `record` | `רשומה` |
| `unknown` | `נעלם` |

**Compatibilidad** de una ranura con su productor: `unknown` (esperado **o**
producido) es comodín; en cualquier otro caso se exige igualdad exacta.

## 5. Validación: el contrato es de todo o nada

`parse_blueprint` devuelve `Option<Blueprint>`: si **cualquier** regla falla el
resultado es `None` (el IDE recibe un `Err` legible y no hay AST). Se rechaza:

* una clave **desconocida** o **repetida** en cualquiera de los tres niveles;
* un número mal formado (ceros a la izquierda, `+`, `NaN`/`Infinity`) o con parte
  fraccionaria donde se espera un entero;
* `arity` fuera de rango, o un `index` negativo o **hacia delante** (rompe la
  aciclicidad);
* un `id` repetido o con caracteres fuera de `[A-Za-z0-9_-]`;
* una ranura cuyo tipo no satisface al productor;
* un `root` declarado que no sea triconsonántico;
* más de `MAX_BLOCKS` bloques, más de `MAX_BLUEPRINT_BYTES` o más anidamiento del
  admitido.

El JSON se analiza con reglas **estrictas** de RFC 8259 (el escáner vive en el
propio módulo: cero dependencias), con pares subrogados resueltos y claves únicas
por objeto; el tope de claves de un objeto es `MAX_BLOCKS * 4`.

## 6. El informe (`VisualReport`)

| Campo | Significado |
| --- | --- |
| `blocks` | bloques traducidos |
| `edges` | aristas del grafo (suma de entradas) |
| `depth` | profundidad del camino más largo |
| `hazardMean` / `hazardMax` | riesgo medio y máximo |
| `hazardBound` | **cota áurea del peor caso**: `máx + (máx − mín)/φ`, saturada a `1` |
| `sealed` | nodos que nacen sellados (guarda, o `hazard > SEAL_THRESHOLD`) |
| `order` | orden topológico (igual al orden de los índices: toda arista apunta atrás) |
| `cells` · `minDistance` · `radius` | retícula de Fermat (`r_k = √k`, `θ_k = k·2π/φ²`), distancia mínima medida y radio |
| `checks` | las siete comprobaciones del §7 |
| `verdict` | resumen legible en una línea |
| `verified` | ¿el ADN se autoverificó? |
| `rootHex` · `signatureHex` · `keyId` | raíz de Merkle, firma y clave (hexadecimal / identificador) |

## 7. Las siete comprobaciones

`validate` (y `report.checks`) publican, con nombre exacto, el resultado de:

| `name` | Qué exige |
| --- | --- |
| `bloques` | `1 ≤ bloques ≤ 256` |
| `aridad` | fuente sin entradas; el resto con exactamente `arity` ranuras |
| `tipos` | cada ranura compatible con el `ret` de su productor (`unknown` = comodín) |
| `orden` | toda arista apunta a un índice **menor** |
| `riesgo` | todo `hazard ∈ [0, 1]` y `máx ≤ cota áurea ≤ 1` |
| `reticula` | `d_min ≥ MIN_CELL_DISTANCE` (0.28), o un solo bloque |
| `radio` | radio de la retícula ≤ `√MAX_BLOCKS` |

Es una **auditoría independiente**: se repite sobre los bloques ya traducidos, así
que también vale para lienzos construidos a mano (los tipos son públicos).

## 8. Salida: AST, guion y ADN

* **AST *Shoresh*** — un nodo por bloque, en orden: `root`, `original` = `name`,
  `arity`, `ret`, `hazard`, `sanitized` y valencia paraconsistente
  `(1 − hazard, hazard)` (la misma `QuantumState::paraconsistent` del runtime).
* **Guion *Shoresh*** — legible y ejecutable por el oráculo sin retoques: cabecera
  con `module`/`label`/`bloques`/`aristas`, la raíz de cada bloque con su `id` y su
  clase, `שמר` tras los sellados, `אמר` tras cada sumidero, y el cierre `עבד` ·
  `:estado` · `:salir`.
* **ADN firmado** — `ast_dna(label, ast, key)`: raíz de Merkle del AST y firma
  `HMAC‑SHA‑256` bajo la clave que reciba el constructor, autoverificada antes de
  publicarse (`verified`). Determinista: mismas entradas y misma clave ⇒ misma
  firma.

## 9. Cotas y constantes

Las publica el kernel (`visual_catalogue().limits`) y son idénticas a las que
aplica el parser: duplicarlas en la interfaz sería una segunda fuente de verdad.

| Constante | Valor | Qué acota |
| --- | --- | --- |
| `maxBlocks` | 256 | bloques por lienzo (y máximo de `arity`) |
| `maxBlueprintBytes` | 65 536 | tamaño del texto del lienzo |
| `maxJsonDepth` | 32 | anidamiento del JSON admitido |
| `maxIdChars` | 64 | longitud de `module` y de `id` |
| `sealThreshold` | 0.5 | desde aquí el nodo nace sellado (`hazard > 0.5`) |
| `minCellDistance` | 0.28 | distancia mínima exigida entre celdas |

## 10. Composición

`visual_compose` recibe una **lista** de lienzos y devuelve **un** `VisualBuildView`:

1. cada lienzo se valida con el contrato completo (uno inválido anula la
   composición entera: `Err(CONTRATO)`);
2. los AST se **injertan** en orden (`ShoreshAst::graft`): el primero abre el
   módulo y los siguientes se añaden a continuación;
3. la etiqueta firmada es la del **primer** lienzo con el sufijo `:compuesto`, y
   el `module` publicado es el del primero;
4. el informe agrega bloques, aristas, riesgo y retícula de todas las partes, y la
   profundidad es la máxima de las partes.

El orden es significativo y determinista (la raíz de Merkle depende de la
secuencia de nodos), así que «A, B» y «B, A» producen ADN distintos. El tope de 8
lienzos (`MAX_COMPOSED_CANVASES`) es **del panel**, no del kernel.

## 11. Clave y limitaciones declaradas

* El ADN se firma con una clave **fija y pública** del IDE:
  `VISUAL_KEY_SEED` = `b"bara-ide:lienzo-visual:v1"`, expandida con
  `golden_key`. El sello prueba **integridad y reproducibilidad** —el mismo lienzo
  da siempre la misma raíz de Merkle y la misma firma, y cualquier alteración las
  cambia—, **no** identidad: no hay custodia de clave ni secreto de usuario.
* La validación es **de bloque**: `parse_blueprint` devuelve `None` y el kernel no
  publica *qué* regla falló. El motor del IDE devuelve un único diagnóstico
  (`CONTRATO`, la enumeración completa del contrato) en lugar de inventar una
  causa; el informe del §6 sólo existe cuando el lienzo ya es válido.
* La retícula se publica en coordenadas del kernel (disco de radio `√k`); el panel
  sólo las **normaliza** a porcentajes para pintarlas en su disco. Es una
  transformación afín por eje: la forma se conserva, las distancias absolutas no.

## 12. Cómo se usa en el panel

* Al abrirse, el panel pide el contrato (`visual_catalogue`) y el ejemplo
  (`visual_sample`) **al kernel**; el ejemplo siembra el editor sólo si el usuario
  no ha escrito nada todavía.
* Editar dispara una traducción con retardo de **300 ms** (una llamada por pausa,
  no por tecla). Un lienzo inválido borra la vista anterior y muestra el error.
* «Traducir y firmar» fuerza la traducción; «Ejemplo» recarga el lienzo del
  núcleo; «Añadir al compuesto» encola (hasta 8), «Componer» injerta y «Limpiar
  compuesto» vacía la cola.
* «Llevar el programa *Shoresh* al editor» entrega `view.source` al editor del IDE
  (se **añade**, nunca sustituye) y el kernel lo vuelve a analizar.

## 13. Verificación

```powershell
cargo test  -p bara --lib                                    # incluye las 8 pruebas de `visual_builder`
cargo test  -p bara -p bara-ide --features bara-ide/serde     # kernel 110 + motor del IDE 34
cargo clippy --workspace --all-targets -- -D warnings         # salida 0 · 0 avisos de rustc
npm run typecheck                                             # contrato IPC de `web/src/visual.ts`
npm run build                                                 # 45 módulos
```

Cobertura del constructor visual: **8** pruebas unitarias en el kernel
(`visual_builder`) y **5** en el motor del IDE (`src/visual.rs`: proyección,
sello determinista y contrato IPC con `web/src/visual.ts`).


