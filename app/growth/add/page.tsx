"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, CheckCircle, Loader2 } from 'lucide-react';
import { AppHeader } from '@/components/ui/AppHeader';
import { CuteButton } from '@/components/ui/CuteButton';
import { CuteInput } from '@/components/ui/CuteInput';
import { CuteCard } from '@/components/ui/CuteCard';
import { FormSection } from '@/components/ui/FormSection';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { useToast } from '@/components/ui/Toast';
import { useBabyStore } from '@/stores/useBabyStore';
import { getLocalDateStr } from '@/lib/date';

type InputMode = 'manual' | 'ocr';

export default function GrowthAddPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const baby = useBabyStore((s) => s.baby);
  const fetchBaby = useBabyStore((s) => s.fetchBaby);
  const addGrowthMeasurement = useBabyStore((s) => s.addGrowthMeasurement);

  useEffect(() => {
    if (!baby) fetchBaby();
  }, [baby, fetchBaby]);

  const [mode, setMode] = useState<InputMode>('manual');
  const [date, setDate] = useState(getLocalDateStr());
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [head, setHead] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrDone, setOcrDone] = useState(false);
  const [imageSelected, setImageSelected] = useState(false);

  const handleOcrUpload = () => {
    setImageSelected(true);
    setOcrLoading(true);
    setTimeout(() => {
      setOcrLoading(false);
      setOcrDone(true);
      // Mock OCR results
      setDate(getLocalDateStr());
      setWeight('7.35');
      setHeight('67.2');
      setHead('42.1');
    }, 1200);
  };

  const handleSave = () => {
    if (!weight && !height && !head) return;

    if (!baby?.birthDate) {
      showToast('请先在个人中心设置宝宝生日');
      return;
    }

    const birthDate = new Date(baby.birthDate);
    const measureDate = new Date(date);
    const diffMs = measureDate.getTime() - birthDate.getTime();
    const months = diffMs / (1000 * 60 * 60 * 24 * 30.44);
    const days = Math.round((months % 1) * 30.44);

    addGrowthMeasurement({
      date,
      ageInMonths: Math.floor(months),
      ageLabel: `${Math.floor(months)}月${days}天`,
      weightKg: weight ? parseFloat(weight) : undefined,
      heightCm: height ? parseFloat(height) : undefined,
      headCircumferenceCm: head ? parseFloat(head) : undefined,
    });

    showToast('记录保存成功 ✨');
    setTimeout(() => router.push('/growth'), 800);
  };

  return (
    <div className="min-h-[100dvh] bg-bg">
      <AppHeader title="添加测量记录" showBack />

      <div className="px-4 pt-4 pb-8">
        {/* Mode switch */}
        <FormSection title="输入方式">
          <SegmentControl
            options={[
              { value: 'manual', label: '手动输入' },
              { value: 'ocr', label: '拍照识别' },
            ]}
            value={mode}
            onChange={(v) => setMode(v as InputMode)}
          />
        </FormSection>

        {mode === 'ocr' && (
          <>
            {/* Upload area */}
            <CuteCard className="mb-5">
              <div className="flex flex-col items-center py-6">
                <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mb-3">
                  {ocrLoading ? (
                    <Loader2 size={28} className="text-primary animate-spin" />
                  ) : ocrDone ? (
                    <CheckCircle size={28} className="text-mint" />
                  ) : (
                    <Upload size={28} className="text-primary" />
                  )}
                </div>
                {!imageSelected ? (
                  <>
                    <p className="text-sm text-text-secondary mb-4">上传测量记录照片</p>
                    <div className="flex gap-3">
                      <CuteButton variant="primary" size="sm" onClick={handleOcrUpload}>
                        拍照
                      </CuteButton>
                      <CuteButton variant="secondary" size="sm" onClick={handleOcrUpload}>
                        上传图片
                      </CuteButton>
                    </div>
                  </>
                ) : ocrLoading ? (
                  <p className="text-sm text-text-secondary">识别中，请稍候...</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-mint mb-2">识别完成，请确认</p>
                    <button
                      onClick={() => { setImageSelected(false); setOcrDone(false); }}
                      className="text-xs text-text-muted underline"
                    >
                      重新上传
                    </button>
                  </>
                )}
              </div>
            </CuteCard>

            {ocrDone && (
              <div className="animate-slide-up space-y-4">
                <FormSection title="测量日期">
                  <CuteInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </FormSection>
                <FormSection title="体重 (kg)">
                  <CuteInput type="number" value={weight} onChange={(e) => setWeight(e.target.value)} step="0.01" placeholder="kg" />
                </FormSection>
                <FormSection title="身长 (cm)">
                  <CuteInput type="number" value={height} onChange={(e) => setHeight(e.target.value)} step="0.1" placeholder="cm" />
                </FormSection>
                <FormSection title="头围 (cm)">
                  <CuteInput type="number" value={head} onChange={(e) => setHead(e.target.value)} step="0.1" placeholder="cm" />
                </FormSection>
              </div>
            )}
          </>
        )}

        {mode === 'manual' && (
          <div className="space-y-4">
            <FormSection title="测量日期">
              <CuteInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormSection>
            <FormSection title="体重 (kg)">
              <CuteInput type="number" value={weight} onChange={(e) => setWeight(e.target.value)} step="0.01" placeholder="例: 7.35" />
            </FormSection>
            <FormSection title="身长 (cm)">
              <CuteInput type="number" value={height} onChange={(e) => setHeight(e.target.value)} step="0.1" placeholder="例: 67.2" />
            </FormSection>
            <FormSection title="头围 (cm)">
              <CuteInput type="number" value={head} onChange={(e) => setHead(e.target.value)} step="0.1" placeholder="例: 42.1" />
            </FormSection>
          </div>
        )}

        <div className="mt-8">
          <CuteButton fullWidth size="lg" onClick={handleSave}>
            保存测量记录
          </CuteButton>
        </div>
      </div>
    </div>
  );
}
