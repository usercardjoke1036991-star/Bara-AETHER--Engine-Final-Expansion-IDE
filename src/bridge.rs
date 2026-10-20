//! # Puente kernel → IDE (FASE 5) — `bara::ide_bridge` proyectado al panel
//!
//! Este módulo **no decide nada**: monta el estado mínimo que el puente de sólo
//! lectura del núcleo sabe leer —un [`BaraRuntime`] con el documento del editor
//! ejecutado, la pasarela de burbujas y el sistema inmunitario adaptativo— y
//! devuelve **tal cual** los dos documentos JSON que publica `bara::ide_bridge`:
//!
//! * [`bridge_manifest`] — el **contrato** (`Manifest::canon`): esquema,
//!   versión, orden de las secciones, cotas y huella. Es lo primero que pide un
//!   panel al conectar, y su huella no depende de ningún estado leído.
//! * [`bridge_snapshot`] — la **instantánea** (`Snapshot::capture`): las cuatro
//!   secciones canónicas (`identidad`, `inmunidad`, `pasarela`, `nucleo`) con
//!   su huella, su catálogo y el veredicto del documento.
//!
//! ## Por qué se reenvía `String` y no un tipo propio
//! El puente ya escribe su JSON con claves fijas y sin dependencias externas
//! (`Snapshot::json`). Reenviarlo **byte a byte** es lo único que garantiza que
//! el IDE lea exactamente el documento que el núcleo firma: un tipo intermedio
//! sería una segunda fuente de verdad del contrato (y una segunda deriva
//! posible). El tipo lo tiende la interfaz TypeScript (`web/src/bridge.ts`);
//! aquí no se reescribe ni una clave.
//!
//! ## El documento entra por la puerta
//! La instantánea se toma sobre un kernel **vivo**: el texto del editor entra
//! como una burbuja de origen [`BRIDGE_ORIGIN`] por la pasarela
//! (`Gateway::admit`) y el sistema adaptativo la escanea (`ImmuneSystem::scan`).
//! Así la sección `pasarela` publica el veredicto, el peligro y las marcas que
//! calculó **el núcleo** para este documento, y la sección `inmunidad` su
//! respuesta. La puerta decide; el panel sólo lee.
//!
//! ## Invariantes
//! 1. **Sólo lectura**: la puerta y el sistema son locales a la llamada; no se
//!    guarda estado entre peticiones ni se muta la soberanía del núcleo (el
//!    puente sólo recibe préstamos inmutables).
//! 2. **Determinismo**: mismo documento ⇒ mismo JSON (la instantánea no lleva
//!    reloj ni azar).
//! 3. **Totalidad**: el léxico, el runtime y la puerta son totales; el único
//!    error posible es un rechazo tipado de `Snapshot::capture`, que se
//!    devuelve como texto mostrable (`Result<_, String>`, igual que
//!    [`crate::visual_build`]). Nunca se publica una instantánea a medias.

use bara::ide_bridge::{Manifest, Snapshot};
use bara::immune::ImmuneSystem;
use bara::immunity_gateway::Gateway;

use crate::aether::runtime_of;

/// Origen declarado con el que el documento del editor entra en la pasarela.
///
/// Es una etiqueta de procedencia, no una ruta del disco: la puerta la publica
/// tal cual en el rabo de burbujas, de modo que el panel sabe **de dónde** salió
/// la carga que está leyendo.
pub const BRIDGE_ORIGIN: &str = "ide://editor";

/// Número de orden de la burbuja del documento.
///
/// La instantánea se captura de una sola lectura, así que la secuencia es fija:
/// repintar el panel no inventa llegadas nuevas.
const BRIDGE_SEQUENCE: u64 = 0;

/// Contrato del puente: esquema, versión, secciones, cotas y huella.
///
/// Función pura del contrato (`Manifest::canon`): no lee ningún subsistema, de
/// modo que un panel puede guardar la huella al conectar y detectar después
/// cualquier deriva de esquema sin tocar el núcleo.
pub fn bridge_manifest() -> String {
    Manifest::canon().json()
}

/// Instantánea de sólo lectura del núcleo sobre el documento del editor.
///
/// * Ejecuta el documento en un [`BaraRuntime`] limpio ([`runtime_of`], la
///   misma ruta que usan los paneles de las fases 1–3).
/// * Hace entrar el texto por la pasarela (`Gateway::admit`, que recorta la
///   carga a `MAX_PAYLOAD` bytes) y lo escanea con el sistema adaptativo
///   (`ImmuneSystem::scan`).
/// * Captura la instantánea canónica (`Snapshot::capture`) y devuelve su JSON.
///
/// `Err` legible si el puente rechaza una sección (cuerpo vacío, no-JSON o por
/// encima de su cota): en ese caso el IDE no recibe un documento parcial.
pub fn bridge_snapshot(source: &str) -> Result<String, String> {
    let (runtime, _tokens) = runtime_of(source);
    let mut gateway = Gateway::new();
    let mut immune = ImmuneSystem::new();
    // El documento entra por la puerta abierta y el sistema adaptativo lo
    // escanea: el veredicto y la respuesta son del núcleo, no del puente.
    let _ = immune.scan(gateway.admit(BRIDGE_ORIGIN, BRIDGE_SEQUENCE, source.as_bytes()));
    let snapshot =
        Snapshot::capture(&immune, &gateway, &runtime).map_err(|error| error.to_string())?;
    Ok(snapshot.json())
}

// ─────────────────────────────────────────────────────────────────────────
// Pruebas: contrato del manifiesto, instantánea completa y pasarela
// ─────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Documento con una raíz conocida, una desconocida (axiogénesis) y aritmética.
    const DOCUMENTO: &str = "ברא צור\n\"uno\" \"dos\"\n1 + 2\n";

    /// Documento con marcas que la pasarela reconoce como hostiles.
    const HOSTIL: &str = "../$(rm -rf / && drop table usuarios) <script>alert(1)</script>";

    /// Instantánea del documento, ya parseada como valor JSON.
    fn valor(documento: &str) -> serde_json::Value {
        let json = bridge_snapshot(documento).expect("la instantánea debe capturarse");
        serde_json::from_str(&json).expect("el puente emite JSON válido")
    }

    #[test]
    fn el_manifiesto_declara_las_cuatro_secciones_en_orden() {
        let manifiesto: serde_json::Value =
            serde_json::from_str(&bridge_manifest()).expect("el manifiesto debe ser JSON");
        let secciones = manifiesto["secciones"]
            .as_array()
            .expect("el manifiesto declara secciones");
        let nombres: Vec<&str> = secciones
            .iter()
            .filter_map(|seccion| seccion["nombre"].as_str())
            .collect();

        assert_eq!(nombres, ["identidad", "inmunidad", "pasarela", "nucleo"]);
        assert!(
            manifiesto["cota_secciones"].as_u64().unwrap_or_default() >= nombres.len() as u64,
            "el techo de secciones admite las cuatro canónicas"
        );
        assert!(
            !manifiesto["huella"].as_str().unwrap_or_default().is_empty(),
            "el contrato se identifica con una huella"
        );
        assert!(
            secciones
                .iter()
                .all(|seccion| !seccion["origen"].as_str().unwrap_or_default().is_empty()),
            "cada sección declara su origen"
        );
    }

    #[test]
    fn la_instantanea_es_completa_y_su_catalogo_cuadra() {
        let documento = valor(DOCUMENTO);

        assert_eq!(documento["completa"], true);
        assert_eq!(
            documento["manifiesto"], documento["secciones"]["identidad"]["manifiesto"]["huella"],
            "el sobre y la identidad comparten huella"
        );
        let identidad = &documento["secciones"]["identidad"];
        assert_eq!(identidad["solo_lectura"], true);
        assert_eq!(identidad["muta_nucleo"], false);
        assert_eq!(identidad["rechaza"], false);

        let catalogo = documento["catalogo"]
            .as_array()
            .expect("la instantánea publica su catálogo");
        assert_eq!(catalogo.len(), 4);
        assert!(
            catalogo.iter().all(|entrada| entrada["presente"] == true),
            "una instantánea completa publica todas sus secciones"
        );
        let suma: u64 = catalogo
            .iter()
            .filter_map(|entrada| entrada["bytes"].as_u64())
            .sum();
        assert_eq!(suma, documento["bytes"].as_u64().unwrap_or_default());
    }

    #[test]
    fn el_puente_es_determinista() {
        let primera = bridge_snapshot(DOCUMENTO).expect("primera captura");
        let segunda = bridge_snapshot(DOCUMENTO).expect("segunda captura");

        assert_eq!(primera, segunda, "mismo documento ⇒ mismo JSON");
    }

    #[test]
    fn el_documento_entra_por_la_puerta_y_la_inmunidad_responde() {
        let documento = valor(DOCUMENTO);
        let pasarela = &documento["secciones"]["pasarela"];
        let rabo = pasarela["rabo"]
            .as_array()
            .expect("la pasarela publica su rabo");

        assert_eq!(pasarela["burbujas"], 1);
        assert_eq!(rabo.len(), 1);
        assert_eq!(rabo[0]["origen"], BRIDGE_ORIGIN);
        assert_eq!(rabo[0]["orden"], BRIDGE_SEQUENCE);
        assert!(
            !rabo[0]["veredicto"].as_str().unwrap_or_default().is_empty(),
            "la burbuja publica el veredicto del núcleo"
        );

        let inmunidad = &documento["secciones"]["inmunidad"];
        assert!(
            inmunidad["contadores"]["total"]
                .as_u64()
                .unwrap_or_default()
                > 0,
            "el sistema adaptativo registra la exposición"
        );
        assert!(
            !inmunidad["acta"].as_str().unwrap_or_default().is_empty(),
            "la inmunidad publica su acta"
        );
    }

    #[test]
    fn el_documento_hostil_publica_peligro_y_marcas() {
        let documento = valor(HOSTIL);
        let rabo = documento["secciones"]["pasarela"]["rabo"]
            .as_array()
            .expect("la pasarela publica su rabo");
        let burbuja = rabo.first().expect("la carga hostil forma una burbuja");

        assert!(
            burbuja["peligro"].as_u64().unwrap_or_default() > 0,
            "la puerta mide el peligro de la carga"
        );
        assert!(
            !burbuja["marcas"]
                .as_array()
                .expect("la burbuja publica sus marcas")
                .is_empty(),
            "la carga hostil queda marcada"
        );
        assert_eq!(burbuja["estanca"], true, "una carga marcada no se propaga");
    }

    #[test]
    fn el_documento_vacio_tambien_se_proyecta() {
        let documento = valor("");

        assert_eq!(documento["completa"], true);
        assert_eq!(documento["secciones"]["pasarela"]["burbujas"], 1);
        assert_eq!(documento["secciones"]["nucleo"]["memoria"], 0);
    }
}
