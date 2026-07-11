import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../LanguageContext';
import { translations } from '../i18n';
import { api, type Ward } from '../api';
import { Mic, Image as ImageIcon, FileText, Send, CheckCircle2, Loader2, StopCircle } from 'lucide-react';
import ChannelsPanel from '../components/ChannelsPanel';

const SubmitPage: React.FC = () => {
  const { language } = useLanguage();
  const t = translations[language];

  const [wards, setWards] = useState<Ward[]>([]);
  const [selectedWard, setSelectedWard] = useState('');
  
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [isCached, setIsCached] = useState(false);

  useEffect(() => {
    api.getWards().then(res => {
      if (res.data) setWards(res.data.wards);
    });
  }, []);

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      
      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Mic access failed, fallback to file upload', err);
      // Fallback to file input
      audioInputRef.current?.click();
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };
  
  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAudioBlob(e.target.files[0]);
    }
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPhotoBlob(e.target.files[0]);
    }
  };

  const handleSubmit = async () => {
    if (!selectedWard) return alert(t.wardLabel + ' is required');
    if (!text && !audioBlob && !photoBlob) return alert('Please provide text, audio, or photo');

    setIsSubmitting(true);
    setSubmitError(null);
    const formData = new FormData();
    formData.append('ward', selectedWard);
    formData.append('lang_hint', language);

    if (text) {
      formData.append('channel', 'text');
      formData.append('text', text);
    } else if (audioBlob) {
      formData.append('channel', 'voice');
      formData.append('audio', audioBlob);
    } else if (photoBlob) {
      formData.append('channel', 'photo');
      formData.append('image', photoBlob);
      if (caption) formData.append('caption', caption);
    }

    // Bug fix: isSubmitting must always reset, and a real rejection (validation,
    // rate limit, server error) must be shown — not silently swallowed, which
    // previously left the button stuck on "Submitting..." with no explanation.
    try {
      const res = await api.ingestGrievance(formData);
      if (res.data) {
        setSubmissionId(res.data.submission_id);
        setStatus(res.data.status);
        if (res.cached) setIsCached(true);

        // Start polling if not processed
        if (res.data.status !== 'processed') {
          pollStatus(res.data.submission_id);
        }
      } else {
        setSubmitError(res.error?.message ?? 'Submission was rejected. Please check your input and try again.');
      }
    } catch (err) {
      console.error(err);
      setSubmitError('Failed to submit. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const pollStatus = async (id: string) => {
    const interval = setInterval(async () => {
      const res = await api.getSubmission(id);
      if (res.data) {
        setStatus(res.data.status);
        if (res.data.status === 'processed' || res.data.status === 'failed') {
          clearInterval(interval);
        }
      }
    }, 2000);
  };

  // Reset form
  const handleReset = () => {
    setSubmissionId(null);
    setStatus('');
    setText('');
    setCaption('');
    setAudioBlob(null);
    setPhotoBlob(null);
    setIsSubmitting(false);
    setIsCached(false);
    setSubmitError(null);
  };

  if (submissionId) {
    return (
      <div style={{ maxWidth: '390px', margin: '0 auto', padding: 'var(--spacing-lg)', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <CheckCircle2 size={64} style={{ color: 'var(--color-primary)', marginBottom: 'var(--spacing-md)' }} />
        <h2 style={{ color: 'var(--color-primary)', textAlign: 'center' }}>{t.successTitle}</h2>
        
        {isCached && (
          <span className="badge badge-cached m-b-md">Cached Demo Mode</span>
        )}

        <div className="card m-b-md" style={{ width: '100%', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{t.successMsg}</p>
          <p style={{ fontFamily: 'monospace', margin: 'var(--spacing-sm) 0', wordBreak: 'break-all' }}>{submissionId}</p>
          
          <div style={{ marginTop: 'var(--spacing-md)', padding: 'var(--spacing-sm)', backgroundColor: 'var(--color-background)', borderRadius: 'var(--border-radius-sm)' }}>
            <strong>{t.status}: </strong>
            <span style={{ textTransform: 'uppercase', fontSize: '0.85rem' }}>{status}</span>
            {status !== 'processed' && status !== 'failed' && <Loader2 className="lucide-spin" size={16} style={{ display: 'inline-block', marginLeft: '4px', verticalAlign: 'middle' }} />}
          </div>
        </div>
        
        <button className="btn-primary" onClick={handleReset}>Submit Another</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '390px', margin: '0 auto', padding: 'var(--spacing-md)', width: '100%', flex: 1, backgroundColor: 'var(--color-background)' }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <h2 style={{ color: 'var(--color-primary)', textAlign: 'center', margin: 0 }}>{t.submitGrievance}</h2>
        
        {/* Ward Selector */}
        <div>
          <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: '0.875rem', fontWeight: 600 }}>{t.wardLabel}</label>
          <select 
            className="input-field" 
            value={selectedWard} 
            onChange={e => setSelectedWard(e.target.value)}
          >
            <option value="">-- {t.wardLabel} --</option>
            {wards.map(w => (
              <option key={w.name} value={w.name}>{w.name}</option>
            ))}
          </select>
        </div>

        {/* Input Modes */}
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'center' }}>
          <button 
            type="button"
            className={!textMode && !photoBlob && !audioBlob ? 'btn-primary' : 'btn-outline'}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            onClick={() => setTextMode(false)}
          >
            <Mic size={18} /> Voice
          </button>
          <button 
            type="button"
            className={textMode ? 'btn-primary' : 'btn-outline'}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            onClick={() => { setTextMode(true); setAudioBlob(null); setPhotoBlob(null); }}
          >
            <FileText size={18} /> Text
          </button>
        </div>

        {/* Dynamic Input Area */}
        <div style={{ padding: 'var(--spacing-md)', backgroundColor: '#F9F7F4', borderRadius: 'var(--border-radius-md)', minHeight: '150px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {textMode ? (
            <textarea 
              className="input-field" 
              rows={5} 
              placeholder={t.textInstruction}
              value={text}
              onChange={e => setText(e.target.value)}
            />
          ) : (
            <>
              {audioBlob ? (
                <div style={{ textAlign: 'center' }}>
                  <audio src={URL.createObjectURL(audioBlob)} controls style={{ maxWidth: '100%' }} />
                  <button onClick={() => setAudioBlob(null)} style={{ color: 'var(--color-error)', marginTop: 'var(--spacing-sm)', textDecoration: 'underline' }}>Remove Audio</button>
                </div>
              ) : photoBlob ? (
                <div style={{ textAlign: 'center' }}>
                  <img src={URL.createObjectURL(photoBlob)} alt="Preview" style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px', objectFit: 'cover' }} />
                  <input type="text" className="input-field" style={{ marginTop: 'var(--spacing-sm)' }} placeholder="Caption (optional)" value={caption} onChange={e => setCaption(e.target.value)} />
                  <button onClick={() => setPhotoBlob(null)} style={{ color: 'var(--color-error)', marginTop: 'var(--spacing-sm)', textDecoration: 'underline' }}>Remove Photo</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                  
                  {isRecording ? (
                    <button 
                      className="btn-accent" 
                      style={{ borderRadius: '50%', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pulse 1.5s infinite' }}
                      onClick={handleStopRecording}
                    >
                      <StopCircle size={32} />
                    </button>
                  ) : (
                    <button 
                      className="btn-primary" 
                      style={{ borderRadius: '50%', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onClick={handleStartRecording}
                    >
                      <Mic size={32} />
                    </button>
                  )}
                  
                  <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{isRecording ? 'Recording...' : t.voiceInstruction}</span>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', width: '100%' }}>
                    <hr style={{ flex: 1, borderTop: '1px solid #E5E7EB' }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>OR</span>
                    <hr style={{ flex: 1, borderTop: '1px solid #E5E7EB' }} />
                  </div>
                  
                  <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                    <button className="btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }} onClick={() => photoInputRef.current?.click()}>
                      <ImageIcon size={16} /> {t.photoInstruction}
                    </button>
                    {/* Fallback audio upload */}
                    <button className="btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }} onClick={() => audioInputRef.current?.click()}>
                      Upload Audio
                    </button>
                  </div>
                  
                  {/* Hidden inputs */}
                  <input type="file" accept="image/*" capture="environment" ref={photoInputRef} style={{ display: 'none' }} onChange={handlePhotoCapture} />
                  <input type="file" accept="audio/*" ref={audioInputRef} style={{ display: 'none' }} onChange={handleAudioUpload} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Submit error — a real rejection (validation/rate-limit/server error) must
            be visible, not silently swallowed */}
        {submitError && (
          <div role="alert" style={{ padding: 'var(--spacing-sm)', backgroundColor: '#FDECEA', color: 'var(--color-error)', borderRadius: 'var(--border-radius-sm)', fontSize: '0.85rem' }}>
            {submitError}
          </div>
        )}

        {/* Submit Button */}
        <button
          className="btn-primary"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}
          onClick={handleSubmit}
          disabled={isSubmitting || (!text && !audioBlob && !photoBlob)}
        >
          {isSubmitting ? <><Loader2 className="lucide-spin" size={18} /> {t.submitting}</> : <><Send size={18} /> {t.submitBtn}</>}
        </button>

        {/* Multi-channel intake: WhatsApp QR + call-in number (Twilio) — the visible
            face of the no-app complaint channels. Hidden when channels unconfigured. */}
        <ChannelsPanel />
      </div>

      {/* Required for the pulse animation */}
      <style>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(232, 135, 30, 0.7); }
          70% { box-shadow: 0 0 0 15px rgba(232, 135, 30, 0); }
          100% { box-shadow: 0 0 0 0 rgba(232, 135, 30, 0); }
        }
        .lucide-spin { animation: spin 2s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default SubmitPage;
