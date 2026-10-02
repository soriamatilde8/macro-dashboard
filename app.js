/**
 * MACRO DASHBOARD - Data Architecture
 * 
 * Este módulo gestiona la obtención de datos reales desde APIs públicas.
 * Cada indicador está separado en funciones independientes para:
 * - Facilitar debugging y mantenimiento
 * - Permitir fallos parciales sin afectar otros indicadores
 * - Usar localStorage como fallback para datos válidos previos
 */

// ============================================================================
// CONFIG Y UTILIDADES
// ============================================================================

const CONFIG = {
  // Tiempos de actualización (ms)
  MARKET_DATA_INTERVAL: 5 * 60 * 1000,      // 5 minutos para datos de mercado
  MACRO_DATA_INTERVAL: 30 * 60 * 1000,      // 30 minutos para datos macro
  RETRY_INTERVAL: 2 * 60 * 1000,            // 2 minutos si hay error

  // Storage keys
  STORAGE_PREFIX: 'macro_dashboard_',

  // Timeouts
  FETCH_TIMEOUT: 8000 // 8 segundos
};

/**
 * Fetch con timeout configurable
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Guardar dato en localStorage con metadata
 */
function saveToStorage(key, value, metadata = {}) {
  const storageKey = CONFIG.STORAGE_PREFIX + key;
  const data = {
    value,
    timestamp: new Date().toISOString(),
    ...metadata
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (e) {
    console.warn(`No se pudo guardar ${key} en localStorage:`, e);
  }
}

/**
 * Recuperar dato de localStorage
 */
function getFromStorage(key) {
  const storageKey = CONFIG.STORAGE_PREFIX + key;
  try {
    const data = localStorage.getItem(storageKey);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.warn(`No se pudo recuperar ${key} de localStorage:`, e);
    return null;
  }
}

// ============================================================================
// ARGENTINA - INDEC (Inflación)
// ============================================================================

/**
 * Obtener IPC mensual de Argentina desde INDEC
 * 
 * Endpoint semi-oficial (no documentado pero relativamente estable)
 * Devuelve variación mensual del IPC nacional
 */
async function fetchArgentinaInflationMonthly() {
  try {
    const url = 'https://apisestadisticas.indec.gob.ar/cuadros/28-IPC-nacional-var-mens.json';
    const response = await fetchWithTimeout(url);
    const data = await response.json();
    
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Estructura de datos no esperada');
    }

    // Último dato disponible
    const lastEntry = data.data[data.data.length - 1];
    
    if (!lastEntry) {
      throw new Error('No hay datos disponibles');
    }

    const result = {
      value: parseFloat(lastEntry[1]),
      period: lastEntry[0],
      source: 'INDEC',
      sourceUrl: 'https://www.indec.gob.ar',
      dataType: 'monthly_variation'
    };

    saveToStorage('arg_inflation_monthly', result);
    return result;
  } catch (error) {
    console.error('Error fetching Argentina monthly inflation:', error);
    
    // Intentar recuperar del localStorage
    const cached = getFromStorage('arg_inflation_monthly');
    if (cached) {
      return { ...cached, isStale: true };
    }
    
    return null;
  }
}

/**
 * Obtener IPC interanual de Argentina desde INDEC
 * 
 * Endpoint para variación interanual (año sobre año)
 */
async function fetchArgentinaInflationYoY() {
  try {
    const url = 'https://apisestadisticas.indec.gob.ar/cuadros/29-IPC-nacional-var-int.json';
    const response = await fetchWithTimeout(url);
    const data = await response.json();
    
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Estructura de datos no esperada');
    }

    const lastEntry = data.data[data.data.length - 1];
    
    if (!lastEntry) {
      throw new Error('No hay datos disponibles');
    }

    const result = {
      value: parseFloat(lastEntry[1]),
      period: lastEntry[0],
      source: 'INDEC',
      sourceUrl: 'https://www.indec.gob.ar',
      dataType: 'yoy_variation'
    };

    saveToStorage('arg_inflation_yoy', result);
    return result;
  } catch (error) {
    console.error('Error fetching Argentina YoY inflation:', error);
    
    const cached = getFromStorage('arg_inflation_yoy');
    if (cached) {
      return { ...cached, isStale: true };
    }
    
    return null;
  }
}

// ============================================================================
// ARGENTINA - BCRA (Tasas, Tipo de cambio)
// ============================================================================

/**
 * Obtener USD/ARS desde BCRA
 * 
 * API oficial del Banco Central de Argentina
 * Devuelve el tipo de cambio de referencia oficial
 */
async function fetchUsdArs() {
  try {
    const url = 'https://api.bcra.gob.ar/estadisticas/v1/cotizaciones';
    const response = await fetchWithTimeout(url);
    const data = await response.json();
    
    if (!data.detalle) {
      throw new Error('Estructura de datos no esperada');
    }

    const usdEntry = data.detalle.find(item => item.codigoMoneda === 'USD');
    
    if (!usdEntry) {
      throw new Error('No se encontró cotización USD');
    }

    const result = {
      value: usdEntry.tipoCotizacion,
      date: data.fecha || new Date().toISOString().split('T')[0],
      source: 'BCRA',
      sourceUrl: 'https://www.bcra.gob.ar',
      description: usdEntry.descripcion
    };

    saveToStorage('usd_ars', result);
    return result;
  } catch (error) {
    console.error('Error fetching USD/ARS:', error);
    
    const cached = getFromStorage('usd_ars');
    if (cached) {
      return { ...cached, isStale: true };
    }
    
    return null;
  }
}

/**
 * Obtener Tasa de Política Monetaria del BCRA
 * 
 * Nota: El BCRA tiene estructura variable en tasas.
 * Este endpoint intenta obtener la tasa de política del banco central.
 */
async function fetchArgentinaRate() {
  try {
    // BCRA publica tasa de referencia/política a través de diferentes endpoints
    // Este es un endpoint de estadísticas generales
    const url = 'https://api.bcra.gob.ar/estadisticas/v1.0/tasas';
    const response = await fetchWithTimeout(url);
    const data = await response.json();
    
    // La estructura varía según el endpoint específico del BCRA
    // Por ahora, intentar acceso genérico
    if (!data || Object.keys(data).length === 0) {
      throw new Error('No se encontraron tasas disponibles');
    }

    // Datos de demostración: El BCRA actualmente usa Tasa de Política de Contracción
    // Buscar en su base de datos oficial: https://www.bcra.gob.ar/
    
    const result = {
      value: null,
      source: 'BCRA',
      sourceUrl: 'https://www.bcra.gob.ar',
      error: 'Endpoint de tasas no disponible públicamente. Consultar sitio oficial del BCRA.'
    };

    return result;
  } catch (error) {
    console.error('Error fetching Argentina policy rate:', error);
    
    const cached = getFromStorage('arg_rate');
    if (cached) {
      return { ...cached, isStale: true };
    }
    
    return {
      value: null,
      source: 'BCRA',
      sourceUrl: 'https://www.bcra.gob.ar',
      error: 'No disponible a través de API pública'
    };
  }
}

// ============================================================================
// ESTADOS UNIDOS - BLS y Federal Reserve
// ============================================================================

/**
 * Obtener CPI mensual de EE.UU. desde BLS
 * 
 * Nota: BLS requiere API key para acceso directo.
 * Como alternativa, usar descarga CSV o fuentes secundarias.
 * 
 * Este es un placeholder que documenta la limitación de CORS.
 */
async function fetchUSInflation() {
  try {
    // BLS API requiere autenticación. Alternativa: usar datos descargados manualmente
    // o integrar con servicio proxy que maneje CORS.
    
    // Intento con CORS proxy (puede no ser estable):
    const bslSeriesId = 'CUUR0000SA0'; // CPI-U All Items
    
    // Nota: Para producción, considerar:
    // 1. Backend propio que proxifique BLS
    // 2. Scraping controlado de datos públicos
    // 3. Servicio de terceros que mantenga estos datos
    
    // Por ahora, retornar null indicando limitación
    const result = {
      value: null,
      source: 'U.S. Bureau of Labor Statistics',
      sourceUrl: 'https://www.bls.gov/cpi/',
      error: 'CPI de BLS requiere API key. Para producción, configurar backend proxy o usar descarga manual de datos CSV.'
    };

    return result;
  } catch (error) {
    console.error('Error fetching US inflation:', error);
    
    return {
      value: null,
      source: 'U.S. Bureau of Labor Statistics',
      sourceUrl: 'https://www.bls.gov/cpi/',
      error: 'No disponible a través de API pública sin autenticación'
    };
  }
}

/**
 * Obtener Federal Funds Rate desde Federal Reserve
 * 
 * Similar limitación: requiere acceso a FRED API con key.
 */
async function fetchFedRate() {
  try {
    // FRED API requiere autenticación. Documentar limitación.
    
    const result = {
      value: null,
      source: 'Federal Reserve (FRED)',
      sourceUrl: 'https://fred.stlouisfed.org',
      error: 'Federal Funds Rate requiere API key de FRED. Registrarse gratis en https://fred.stlouisfed.org/docs/api/'
    };

    return result;
  } catch (error) {
    console.error('Error fetching Fed rate:', error);
    
    return {
      value: null,
      source: 'Federal Reserve (FRED)',
      sourceUrl: 'https://fred.stlouisfed.org',
      error: 'No disponible a través de API pública sin autenticación'
    };
  }
}

// ============================================================================
// EUROZONA - Eurostat y ECB
// ============================================================================

/**
 * Obtener HICP (inflación) de Eurozona desde Eurostat
 * 
 * API oficial de Eurostat - datos públicos sin autenticación
 * Devuelve Índice de Precios de Consumo Armonizado (HICP)
 */
async function fetchEurozoneInflation() {
  try {
    // Eurostat JSON-stat API
    // Datos para Eurozona (EA20), índice general (CP00), últimos datos disponibles
    const url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_aind?geo=EA20&coicop=CP00&time=2024M12';
    
    const response = await fetchWithTimeout(url);
    const data = await response.json();
    
    // JSON-stat es un formato comprimido. Buscar el valor en la estructura.
    if (!data.value || !data.dimension) {
      throw new Error('Estructura JSON-stat no esperada');
    }

    // El primer (y generalmente único) valor es el HICP
    const value = Object.values(data.value)[0];
    
    if (value === null || value === undefined) {
      throw new Error('No hay valor de HICP disponible');
    }

    const result = {
      value: parseFloat(value),
      period: 'Último dato disponible',
      source: 'Eurostat',
      sourceUrl: 'https://ec.europa.eu/eurostat',
      dataType: 'hicp_annual_rate'
    };

    saveToStorage('eurozone_inflation', result);
    return result;
  } catch (error) {
    console.error('Error fetching Eurozone inflation:', error);
    
    const cached = getFromStorage('eurozone_inflation');
    if (cached) {
      return { ...cached, isStale: true };
    }
    
    return null;
  }
}

/**
 * Obtener ECB Deposit Rate (tasa de política de ECB)
 * 
 * ECB publica datos estadísticos, pero acceso a tasas puede requerir parseo de HTML
 * o acceso a base de datos estadística específica.
 */
async function fetchECBRate() {
  try {
    // ECB Statistical Data Warehouse requiere acceso específico
    // Por ahora, documentar limitación
    
    const result = {
      value: null,
      source: 'European Central Bank',
      sourceUrl: 'https://www.ecb.europa.eu',
      error: 'ECB Rates requieren acceso a Statistical Data Warehouse. Datos disponibles en https://www.ecb.europa.eu/stats/'
    };

    return result;
  } catch (error) {
    console.error('Error fetching ECB rate:', error);
    
    return {
      value: null,
      source: 'European Central Bank',
      sourceUrl: 'https://www.ecb.europa.eu',
      error: 'No disponible a través de API pública'
    };
  }
}

/**
 * Obtener EUR/USD desde fuente pública
 * 
 * Usar API de tipo de cambio pública (ej: exchangerate-api.com, fixer.io, etc.)
 * Algunas ofrecen acceso gratuito limitado sin autenticación o con tier freemium.
 */
async function fetchEurUsd() {
  try {
    // Opción 1: exchange-rate-api.com (tier libre disponible)
    // Nota: Verificar CORS y límites de uso
    
    const url = 'https://api.exchangerate-api.com/v4/latest/EUR';
    const response = await fetchWithTimeout(url);
    const data = await response.json();
    
    if (!data.rates || !data.rates.USD) {
      throw new Error('Estructura de datos no esperada');
    }

    const result = {
      value: data.rates.USD,
      date: new Date().toISOString().split('T')[0],
      source: 'Exchange Rate API',
      sourceUrl: 'https://exchangerate-api.com',
      baseCurrency: 'EUR',
      targetCurrency: 'USD'
    };

    saveToStorage('eur_usd', result);
    return result;
  } catch (error) {
    console.error('Error fetching EUR/USD (API 1):', error);
    
    // Intento con fuente alternativa
    try {
      const altUrl = 'https://open.er-api.com/v6/latest/EUR';
      const response = await fetchWithTimeout(altUrl);
      const data = await response.json();
      
      if (!data.rates || !data.rates.USD) {
        throw new Error('Estructura alternativa no esperada');
      }

      const result = {
        value: data.rates.USD,
        date: new Date().toISOString().split('T')[0],
        source: 'Open Exchange Rates',
        sourceUrl: 'https://openexchangerates.org',
        baseCurrency: 'EUR',
        targetCurrency: 'USD'
      };

      saveToStorage('eur_usd', result);
      return result;
    } catch (altError) {
      console.error('Error fetching EUR/USD (API 2):', altError);
      
      const cached = getFromStorage('eur_usd');
      if (cached) {
        return { ...cached, isStale: true };
      }
      
      return null;
    }
  }
}

// ============================================================================
// AGGREGATOR: Obtener todos los datos
// ============================================================================

/**
 * Ejecutar todas las llamadas a APIs en paralelo
 */
async function fetchAllData() {
  const startTime = performance.now();
  
  const results = await Promise.all([
    fetchArgentinaInflationMonthly(),
    fetchArgentinaInflationYoY(),
    fetchUsdArs(),
    fetchArgentinaRate(),
    fetchUSInflation(),
    fetchFedRate(),
    fetchEurozoneInflation(),
    fetchECBRate(),
    fetchEurUsd()
  ]);

  const endTime = performance.now();
  
  const data = {
    argentina: {
      inflationMonthly: results[0],
      inflationYoY: results[1],
      rate: results[3]
    },
    forex: {
      usdArs: results[2],
      eurUsd: results[8]
    },
    usa: {
      inflation: results[4],
      rate: results[5]
    },
    eurozone: {
      inflation: results[6],
      rate: results[7]
    },
    lastFetch: new Date().toISOString(),
    fetchDuration: `${(endTime - startTime).toFixed(0)}ms`
  };

  // Guardar agregado completo
  saveToStorage('all_data', data);
  
  return data;
}

/**
 * Obtener datos con fallback a localStorage
 */
async function getAllDataWithFallback() {
  try {
    return await fetchAllData();
  } catch (error) {
    console.error('Error in fetchAllData:', error);
    
    const cached = getFromStorage('all_data');
    if (cached) {
      return { ...cached, isStale: true, staleSince: cached.lastFetch };
    }
    
    // Retornar estructura vacía si no hay caché
    return {
      argentina: { inflationMonthly: null, inflationYoY: null, rate: null },
      forex: { usdArs: null, eurUsd: null },
      usa: { inflation: null, rate: null },
      eurozone: { inflation: null, rate: null },
      error: 'No se pudieron obtener datos. Verifica tu conexión.'
    };
  }
}

// ============================================================================
// INICIALIZACIÓN Y ACTUALIZACIÓN PERIÓDICA
// ============================================================================

let updateIntervals = [];

/**
 * Iniciar actualización periódica de datos
 */
function startDataUpdates() {
  // Obtener datos iniciales
  getAllDataWithFallback().then(data => {
    window.dashboardData = data;
    renderDashboard();
  });

  // Establecer intervalos de actualización
  const macroInterval = setInterval(() => {
    getAllDataWithFallback().then(data => {
      window.dashboardData = data;
      renderDashboard();
      console.log('Datos actualizados a las', new Date().toLocaleTimeString());
    });
  }, CONFIG.MACRO_DATA_INTERVAL);

  updateIntervals.push(macroInterval);
}

/**
 * Detener actualizaciones (para limpiar)
 */
function stopDataUpdates() {
  updateIntervals.forEach(id => clearInterval(id));
  updateIntervals = [];
}

// Exportar funciones para testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchArgentinaInflationMonthly,
    fetchArgentinaInflationYoY,
    fetchUsdArs,
    fetchArgentinaRate,
    fetchUSInflation,
    fetchFedRate,
    fetchEurozoneInflation,
    fetchECBRate,
    fetchEurUsd,
    fetchAllData,
    getAllDataWithFallback,
    startDataUpdates,
    stopDataUpdates
  };
}
