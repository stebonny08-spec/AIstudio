"""
Gestione modelli Vision-Language (Qwen3-VL-2B-Q4)
Supporto per immagini + testo con llama-cpp-python build speciale
"""

import os
from typing import Optional, Dict, Any, List
from PIL import Image
import numpy as np

try:
    from llama_cpp import Llama
    LLAMA_CPP_AVAILABLE = True
except ImportError:
    LLAMA_CPP_AVAILABLE = False
    print("⚠️  llama-cpp-python non installato. Installa con: pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121")


class QwenVLClient:
    """
    Client per Qwen3-VL-2B-Q4 (formato GGUF)
    
    Requisiti:
    - Modello GGUF scaricato da HuggingFace (es. Qwen/Qwen3-VL-2B-GGUF)
    - llama-cpp-python compilato con supporto vision (flag -DGGML_CUDA=ON o Vulkan)
    """
    
    def __init__(
        self, 
        model_path: str,
        n_ctx: int = 4096,
        n_gpu_layers: int = -1,  # -1 = tutte le layer su GPU
        verbose: bool = False
    ):
        if not LLAMA_CPP_AVAILABLE:
            raise ImportError(
                "llama-cpp-python non disponibile. "
                "Installa la versione con supporto GPU: "
                "pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121"
            )
        
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Modello non trovato: {model_path}\n"
                f"Scarica Qwen3-VL-2B-Q4 da: https://huggingface.co/Qwen/Qwen3-VL-2B-GGUF"
            )
        
        self.model_path = model_path
        self.verbose = verbose
        
        # Inizializza il modello Qwen-VL
        # Nota: llama-cpp-python supporta nativamente Qwen-VL se compilato correttamente
        self.llm = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_gpu_layers=n_gpu_layers,
            chat_format="qwen-vl",  # Formato speciale per Qwen-VL
            verbose=verbose
        )
        
        if self.verbose:
            print(f"✅ Qwen3-VL-2B caricato da: {model_path}")
    
    def generate_caption(
        self, 
        image: Image.Image, 
        prompt: str = "Descrivi questa immagine in dettaglio:",
        max_tokens: int = 512,
        temperature: float = 0.7
    ) -> str:
        """
        Genera una descrizione (caption) per un'immagine usando Qwen-VL
        
        Args:
            image: Immagine PIL
            prompt: Prompt testuale
            max_tokens: Lunghezza massima risposta
            temperature: Creatività (0.0 = deterministico, 1.0 = creativo)
        
        Returns:
            Caption generata come stringa
        """
        # Converte immagine in formato compatibile
        # Qwen-VL accetta immagini come base64 o path
        import io
        img_buffer = io.BytesIO()
        image.save(img_buffer, format='PNG')
        img_base64 = img_buffer.getvalue()
        
        # Crea messaggio multimodale per Qwen-VL
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": img_base64},
                    {"type": "text", "text": prompt}
                ]
            }
        ]
        
        response = self.llm.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature
        )
        
        caption = response['choices'][0]['message']['content']
        return caption.strip()
    
    def analyze_image_with_context(
        self,
        image: Image.Image,
        context_text: str,
        task: str = "Spiega come il testo si relaziona all'immagine",
        max_tokens: int = 512
    ) -> str:
        """
        Analizza immagine insieme a testo contestuale (es. OCR, LaTeX)
        
        Args:
            image: Immagine PIL
            context_text: Testo contestuale (OCR, formule, ecc.)
            task: Istruzione specifica
            max_tokens: Lunghezza massima
        
        Returns:
            Risposta analitica
        """
        prompt = f"""
Contesto testuale estratto dall'immagine:
{context_text}

{task}. Fornisci una descrizione completa che integri sia l'aspetto visivo che il testo estratto.
"""
        
        return self.generate_caption(image, prompt, max_tokens)
    
    def batch_process_images(
        self,
        images: List[Image.Image],
        prompts: Optional[List[str]] = None,
        max_tokens: int = 512
    ) -> List[str]:
        """
        Elabora multiple immagini in batch
        
        Args:
            images: Lista di immagini PIL
            prompts: Lista di prompt (uno per immagine, o uno singolo per tutte)
            max_tokens: Lunghezza massima per risposta
        
        Returns:
            Lista di caption
        """
        if prompts is None:
            prompts = ["Descrivi questa immagine in dettaglio:"] * len(images)
        elif len(prompts) == 1:
            prompts = prompts * len(images)
        
        captions = []
        for img, prompt in zip(images, prompts):
            caption = self.generate_caption(img, prompt, max_tokens)
            captions.append(caption)
        
        return captions


def load_qwen_vl_model(
    model_dir: str = "./models",
    model_name: str = "qwen3-vl-2b-q4.gguf",
    **kwargs
) -> Optional[QwenVLClient]:
    """
    Carica Qwen3-VL-2B-Q4 dalla cartella specificata
    
    Args:
        model_dir: Cartella contenente i modelli
        model_name: Nome del file GGUF
        **kwargs: Parametri aggiuntivi per QwenVLClient
    
    Returns:
        Istanza di QwenVLClient o None se fallisce
    """
    model_path = os.path.join(model_dir, model_name)
    
    try:
        client = QwenVLClient(model_path, **kwargs)
        return client
    except Exception as e:
        print(f"❌ Errore nel caricamento di Qwen3-VL: {e}")
        print("\nIstruzioni per l'installazione:")
        print("1. Scarica il modello: huggingface-cli download Qwen/Qwen3-VL-2B-GGUF qwen3-vl-2b-q4.gguf --local-dir ./models")
        print("2. Installa llama-cpp-python con supporto GPU:")
        print("   pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121")
        return None


# Esempio di utilizzo
if __name__ == "__main__":
    # Esempio pratico
    model = load_qwen_vl_model(model_dir="./models", model_name="qwen3-vl-2b-q4.gguf")
    
    if model:
        from PIL import Image
        
        # Carica immagine di test
        test_img = Image.open("test_image.png")
        
        # Genera caption
        caption = model.generate_caption(test_img)
        print(f"\n📝 Caption generata:\n{caption}")
        
        # Analisi con contesto OCR
        ocr_text = "R1, R2, 9V, 30mA"
        analysis = model.analyze_image_with_context(
            test_img, 
            ocr_text, 
            "Spiega questo circuito elettrico"
        )
        print(f"\n🔍 Analisi con contesto:\n{analysis}")
