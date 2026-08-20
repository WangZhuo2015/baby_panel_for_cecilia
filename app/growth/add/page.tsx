"use client";
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2, AlertTriangle } from 'lucide-react';
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
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOcrUpload = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件');
      return;
    }
    setOcrLoading(true);
    setOcrError(null);
    setOcrDone(false);
    setImagePreview(URL.createObjectURL(file));
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch('/api/growth/ocr', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setOcrError(data.error || '识别失败，请手动输入');
        return;
      }
      if (data.date) setDate(data.date);
      if (data.weightKg != null) setWeight(String(data.weightKg));
      if (data.heightCm != null) setHeight(String(data.heightCm));
      if (data.headCircumferenceCm != null) setHead(String(data.headCircumferenceCm));
      if (data.imageUrl) setUploadedImageUrl(data.imageUrl);
      setOcrDone(true);
    } catch {
      setOcrError('识别服务连接失败，请手动输入');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleSave = () => {
    if (!weight && !height && !head) return;

    if (!baby?.birthDate) {
      showToast('请先设置宝宝生日');
      router.push('/onboarding');
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
      imageUrl: uploadedImageUrl || undefined,
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
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleOcrUpload(e.target.files?.[0])}
            />
            {/* Upload area */}
            <CuteCard className="mb-5">
              <div className="flex flex-col items-center py-6">
                {imagePreview ? (
                  <div className="w-40 h-40 rounded-2xl overflow-hidden mb-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreview}
                      alt="测量记录照片预览"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mb-3">
                    {ocrLoading ? (
                      <Loader2 size={28} className="text-primary animate-spin" />
                    ) : (
                      <Upload size={28} className="text-primary" />
                    )}
                  </div>
                )}
                {!ocrLoading ? (
                  ocrDone ? (
                    <>
                      <p className="text-sm font-medium text-mint mb-2">识别完成，请核对下方数据</p>
                      <button
                        onClick={() => { fileInputRef.current?.click(); setOcrDone(false); }}
                        className="text-xs text-text-muted underline"
                      >
                        换一张重新识别
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-text-secondary mb-4">上传测量记录照片</p>
                      <div className="flex gap-3">
                        <CuteButton variant="primary" size="sm" onClick={() => fileInputRef.current?.click()}>
                          拍照
                        </CuteButton>
                        <CuteButton variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                          从相册选择
                        </CuteButton>
                      </div>
                      <p className="text-[10px] text-text-muted mt-3">
                        照片将自动归档，方便日后随时查阅核对
                      </p>
                    </>
                  )
                ) : (
                  <p className="text-sm text-text-secondary">识别中，请稍候...</p>
                )}

                {ocrError && !ocrLoading && (
                  <div className="mt-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 max-w-xs">
                    <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600">{ocrError}</p>
                  </div>
                )}
              </div>
            </CuteCard>

            {(ocrDone || ocrError) && (
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
