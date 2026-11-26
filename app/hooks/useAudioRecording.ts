import { useState, useRef } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { Alert, Platform } from 'react-native';

export interface AudioRecordingState {
  isRecording: boolean;
  isTranscribing: boolean;
  recordingUri: string | null;
  recordingDuration: number;
  error: string | null;
}

export interface AudioRecordingActions {
  startRecording: () => Promise<boolean>;
  stopRecording: () => Promise<string | null>;
  cancelRecording: () => Promise<void>;
  clearError: () => void;
}

export const useAudioRecording = (): AudioRecordingState & AudioRecordingActions => {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async (): Promise<boolean> => {
    try {
      setError(null);

      // Permissions
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        setError('Permission microphone refusée');
        return false;
      }

      // Configuration iOS - playsInSilentModeIOS doit être TRUE avec allowsRecording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Options d'enregistrement
      const recordingOptions: Audio.RecordingOptions = {
        android: {
          extension: '.m4a',
          outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
          audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_MEDIUM,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
      };

      // Démarrer l'enregistrement
      const { recording } = await Audio.Recording.createAsync(recordingOptions);
      recordingRef.current = recording;

      setIsRecording(true);
      setRecordingDuration(0);

      // Timer
      durationTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      return true;

    } catch (error) {
      console.error('Erreur enregistrement:', error);
      setError('Erreur lors du démarrage');
      setIsRecording(false);
      return false;
    }
  };

  const stopRecording = async (): Promise<string | null> => {
    try {
      if (!recordingRef.current) return null;

      // Arrêter timer
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }

      // Arrêter enregistrement
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      if (!uri) {
        setError('Pas de fichier créé');
        return null;
      }

      try {
        // Utiliser la nouvelle API File ou fallback sur legacy
        let fileExists = true;
        let fileSize = 0;

        try {
          // Tentative avec la nouvelle API
          const file = new (FileSystem as any).File(uri);
          fileSize = await file.size();
        } catch (newApiError) {
          // Fallback sur l'API legacy
          const fileInfo = await (FileSystem as any).getInfoAsync(uri);
          console.log('📁 Info fichier (legacy):', fileInfo);
          fileExists = fileInfo.exists;
          fileSize = fileInfo.size || 0;
        }

        if (!fileExists) {
          setError('Fichier inexistant');
          return null;
        }

        if (fileSize > 0 && fileSize < 1000) {
          setError(`Fichier trop petit: ${fileSize} bytes`);
          return null;
        }

        console.log('📁 Fichier audio créé:', { uri, size: fileSize });
      } catch (fileCheckError) {
        console.warn('⚠️ Impossible de vérifier le fichier, continuons:', fileCheckError);
        // Continue quand même, le fichier pourrait exister
      }

      setRecordingUri(uri);
      return uri;

    } catch (error) {
      console.error('Erreur arrêt:', error);
      setError('Erreur lors de l\'arrêt');
      setIsRecording(false);
      return null;
    }
  };

  const cancelRecording = async (): Promise<void> => {
    try {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }

      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        recordingRef.current = null;
      }

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      if (recordingUri) {
        try {
          // Utiliser deleteAsync avec gestion d'erreur
          await FileSystem.deleteAsync(recordingUri, { idempotent: true });
        } catch (deleteError) {
          console.warn('⚠️ Impossible de supprimer le fichier:', deleteError);
          // Continue quand même, pas critique
        }
      }

      setIsRecording(false);
      setRecordingUri(null);
      setRecordingDuration(0);
      setError(null);

    } catch (error) {
      console.error('Erreur annulation:', error);
    }
  };

  const clearError = (): void => {
    setError(null);
  };

  return {
    isRecording,
    isTranscribing,
    recordingUri,
    recordingDuration,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
    clearError,
  };
};