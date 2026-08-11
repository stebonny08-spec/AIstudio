"""
core/voice_input.py
----------------------
Riconoscimento vocale tramite la libreria gratuita SpeechRecognition,
usando il servizio web gratuito di Google (nessuna chiave API richiesta,
diverso dalla chiave API di Gemini).

Si "disattiva automaticamente se non rileva suoni": è il comportamento
naturale di recognizer.listen() con un timeout, gestito qui sotto senza
lasciare mai il microfono aperto all'infinito.
"""

from dataclasses import dataclass
from typing import Optional

LISTEN_TIMEOUT_SECONDS = 5      # quanto aspettare che l'utente INIZI a parlare
PHRASE_TIME_LIMIT_SECONDS = 15  # durata massima di una singola frase
LANGUAGE = "it-IT"


@dataclass
class VoiceResult:
    text: str = ""
    error: Optional[str] = None   # messaggio user-friendly se qualcosa è andato storto


def listen_once() -> VoiceResult:
    """Ascolta una singola frase dal microfono di default e la converte in
    testo. Pensata per essere chiamata da un thread di background (è
    un'operazione bloccante): il chiamante gestisce il risultato tramite
    callback, mai chiamare direttamente dal thread della GUI.
    """
    try:
        import speech_recognition as sr
    except ImportError:
        return VoiceResult(error="Libreria SpeechRecognition non installata.")

    recognizer = sr.Recognizer()

    try:
        with sr.Microphone() as source:
            # Calibra il rumore di fondo per qualche istante: riduce falsi
            # rilevamenti e migliora l'accuratezza del riconoscimento.
            recognizer.adjust_for_ambient_noise(source, duration=0.5)
            audio = recognizer.listen(
                source,
                timeout=LISTEN_TIMEOUT_SECONDS,
                phrase_time_limit=PHRASE_TIME_LIMIT_SECONDS,
            )
    except OSError:
        return VoiceResult(error="Nessun microfono trovato sul sistema.")
    except sr.WaitTimeoutError:
        # Nessun suono rilevato: si disattiva automaticamente, come richiesto.
        return VoiceResult(error="Nessun suono rilevato.")

    try:
        text = recognizer.recognize_google(audio, language=LANGUAGE)
        return VoiceResult(text=text)
    except sr.UnknownValueError:
        return VoiceResult(error="Non sono riuscito a capire l'audio.")
    except sr.RequestError:
        return VoiceResult(error="Servizio di riconoscimento vocale non raggiungibile.")
