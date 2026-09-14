"use client";
import { useState, useEffect, useCallback } from 'react';
import { Sun, Droplets, Wind, Thermometer, CloudSun, TreePine } from 'lucide-react';
import { AppHeader } from '@/components/ui/AppHeader';
import { CuteCard } from '@/components/ui/CuteCard';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { useBabyStore } from '@/stores/useBabyStore';

function conditionToEmoji(condition: string): string {
  if (condition.includes('☀') || condition === '晴') return '☀️';
  if (condition.includes('⛅') || condition.includes('多云')) return '⛅';
  if (condition.includes('☁') || condition === '阴') return '☁️';
  if (condition.includes('🌧') || condition.includes('雨')) return '🌧️';
  return '⛅';
}

const checklistItems = [
  { id: 'hat', label: '帽子', emoji: '🧢' },
  { id: 'clothes', label: '备用衣服', emoji: '👕' },
  { id: 'wipes', label: '湿巾', emoji: '🧻' },
  { id: 'bottle', label: '奶瓶', emoji: '🍼' },
  { id: 'diaper', label: '尿布', emoji: '🧷' },
  { id: 'sunscreen', label: '遮阳用品', emoji: '☂️' },
];

export default function WeatherPage() {
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const weather = useBabyStore((s) => s.weather);
  const fetchWeather = useBabyStore((s) => s.fetchWeather);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchWeather();
      if (!useBabyStore.getState().weather) {
        setError('天气数据加载失败，请稍后重试');
      }
    } catch {
      setError('天气数据加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [fetchWeather]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleItem = (id: string) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const weatherData = weather ?? { city: '', condition: '', temperature: 0, uv: 0, rainProbability: 0, humidity: 0, airQuality: '', hourlyForecast: [] };
  const weatherEmoji = conditionToEmoji(weatherData.condition);

  const metrics = [
    { icon: <Sun size={16} />, value: `${weatherData.uv}`, label: 'UV 指数', color: 'text-amber-500' },
    { icon: <Droplets size={16} />, value: `${weatherData.rainProbability}%`, label: '降雨概率', color: 'text-blue-400' },
    { icon: <Wind size={16} />, value: `${weatherData.humidity}%`, label: '湿度', color: 'text-sky-400' },
    { icon: <CloudSun size={16} />, value: weatherData.airQuality, label: '空气质量', color: 'text-green-500' },
  ];

  const adviceNotes = [
    { icon: '🧴', text: '涂抹婴儿防晒（SPF 30+），保护娇嫩肌肤' },
    { icon: '🧢', text: '戴遮阳帽或撑伞，避免阳光直射' },
    { icon: '💧', text: '及时补充水分，少量多次喂食' },
    { icon: '👕', text: '准备备用衣物，出汗或淋湿后更换' },
  ];

  return (
    <div className="px-4 pb-6 max-w-4xl mx-auto">
      {/* Header */}
      <AppHeader title="天气详情" showBack />

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-400">正在加载天气...</p>
          </div>
        </div>
      ) : error || !weather ? (
        <div className="flex items-center justify-center py-20 px-4">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center max-w-sm w-full">
            <p className="text-red-600 font-medium mb-2">天气数据加载失败</p>
            <p className="text-red-400 text-sm mb-4">{error ?? '请稍后重试'}</p>
            <button
              onClick={load}
              className="px-5 py-2 rounded-full bg-primary text-white text-sm font-medium shadow-button btn-press"
            >
              重试
            </button>
          </div>
        </div>
      ) : (
        <>
        {/* Main weather display */}
      <div className="mt-4 mb-5 text-center">
        {/* City */}
        <p className="text-sm text-text-muted mb-2">{weatherData.city}</p>

        {/* Emoji */}
        <div className="text-6xl mb-2 leading-none">{weatherEmoji}</div>

        {/* Temperature */}
        <div className="flex items-start justify-center">
          <span className="text-6xl font-light text-text-primary">{weatherData.temperature}</span>
          <span className="text-2xl font-light text-text-muted mt-2">°C</span>
        </div>

        {/* Description */}
        <p className="text-base text-text-secondary mt-1">{weatherData.condition}</p>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {metrics.map((metric, i) => (
          <div key={i} className="flex flex-col items-center gap-1 py-2.5 rounded-2xl bg-card shadow-soft">
            <span className={metric.color}>{metric.icon}</span>
            <span className="text-sm font-semibold text-text-primary">{metric.value}</span>
            <span className="text-[10px] text-text-muted text-center leading-tight">{metric.label}</span>
          </div>
        ))}
      </div>

      {/* Hourly forecast */}
      <div className="mb-5">
        <SectionTitle title="逐时预报" icon={<Thermometer size={18} className="text-primary" />} className="mb-3" />
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
          {weatherData.hourlyForecast.map((hour) => (
            <div
              key={hour.time}
              className="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-2xl bg-card shadow-soft flex-shrink-0 min-w-[68px]"
            >
              <span className="text-xs text-text-muted">{hour.time}</span>
              <span className="text-lg">{conditionToEmoji(hour.condition)}</span>
              <span className="text-sm font-semibold text-text-primary">{hour.temperature}°</span>
            </div>
          ))}
        </div>
      </div>

      {/* Outdoor advice card */}
      <div className="mb-5">
        <SectionTitle title="宝宝户外建议" icon={<TreePine size={18} className="text-green-500" />} className="mb-3" />
        <CuteCard variant="gradient">
          {/* Best time window */}
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-primary-soft/30">
            <span className="text-lg">🕐</span>
            <div>
              <p className="text-xs text-text-muted">最佳出行时段</p>
              <p className="text-sm font-medium text-text-primary">
                上午 <span className="text-primary font-semibold">8:00–10:00</span> 较适合外出
              </p>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2.5">
            {adviceNotes.map((note, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="text-sm flex-shrink-0 mt-0.5">{note.icon}</span>
                <p className="text-xs text-text-secondary leading-relaxed">{note.text}</p>
              </div>
            ))}
          </div>
        </CuteCard>
      </div>

      {/* Outdoor checklist card */}
      <div className="mb-5">
        <SectionTitle title="宝宝户外 Checklist" icon={<Sun size={18} className="text-amber-500" />} className="mb-3" />
        <CuteCard>
          <div className="grid grid-cols-2 gap-3">
            {checklistItems.map((item) => {
              const isChecked = checkedItems[item.id] ?? false;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-3 rounded-2xl border-2 transition-all duration-200 cursor-pointer ${
                    isChecked
                      ? 'border-primary bg-primary/5 shadow-soft'
                      : 'border-primary-soft/40 bg-transparent hover:border-primary-soft'
                  }`}
                >
                  {/* Custom checkbox */}
                  <span
                    className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${
                      isChecked
                        ? 'border-primary bg-primary'
                        : 'border-primary-soft bg-transparent'
                    }`}
                  >
                    {isChecked && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M2.5 6L5 8.5L9.5 3.5"
                          stroke="white"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="text-sm flex-shrink-0">{item.emoji}</span>
                  <span
                    className={`text-sm font-medium transition-colors ${
                      isChecked ? 'text-primary' : 'text-text-primary'
                    }`}
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </CuteCard>
      </div>
        </>
      )}
    </div>
  );
}
