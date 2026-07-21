import { proxyFetch } from "@/infrastructure/http/fetch";

export interface Weather {
  temp: number;
  high: number;
  low: number;
  code: number;
  label: string;
  wind: number;
  place: string;
  aqi?: number | null;
}

const WMO: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
  80: "Rain showers", 81: "Showers", 82: "Violent showers", 95: "Thunderstorm", 96: "Storm w/ hail",
};

/** Current + today's range from Open-Meteo. Location via env, defaults to Bengaluru. */
export async function getWeather(): Promise<Weather | null> {
  const lat = process.env.SAGE_LAT ?? "12.9716";
  const lon = process.env.SAGE_LON ?? "77.5946";
  const place = process.env.SAGE_PLACE ?? "Bengaluru";
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
    const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi`;
    const [res, aqiRes] = await Promise.all([
      proxyFetch(url, { signal: AbortSignal.timeout(8000) }),
      proxyFetch(aqiUrl, { signal: AbortSignal.timeout(8000) }).catch(() => null),
    ]);
    if (!res.ok) return null;
    let aqi: number | null = null;
    if (aqiRes?.ok) {
      const aj = (await aqiRes.json()) as { current?: { us_aqi?: number } };
      aqi = typeof aj.current?.us_aqi === "number" ? Math.round(aj.current.us_aqi) : null;
    }
    const j = (await res.json()) as {
      current: { temperature_2m: number; weather_code: number; wind_speed_10m: number };
      daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
    };
    return {
      temp: Math.round(j.current.temperature_2m),
      high: Math.round(j.daily.temperature_2m_max[0]),
      low: Math.round(j.daily.temperature_2m_min[0]),
      code: j.current.weather_code,
      label: WMO[j.current.weather_code] ?? "—",
      wind: Math.round(j.current.wind_speed_10m),
      place,
      aqi,
    };
  } catch {
    return null;
  }
}
