"""
OCR Module Avanzato - Riconoscimento ottico dei caratteri con supporto multimodale
Integra: PaddleOCR (OCR), pix2tex (formule LaTeX), CLIP (embedding visivi), Qwen3-VL-2B-Q4 (caption avanzate)
"""

import cv2
import numpy as np
import pytesseract
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
import logging
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AdvancedOCRProcessor:
    """Classe per l'elaborazione OCR avanzata con supporto multimodale"""
    
    def __init__(self, tesseract_cmd: Optional[str] = None):
        """
        Inizializza il motore OCR con tutti i componenti avanzati
        """
        # Tesseract legacy (fallback)
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        
        try:
            pytesseract.get_tesseract_version()
            logger.info("Tesseract OCR disponibile (fallback)")
            self.tesseract_available = True
        except Exception:
            logger.warning("Tesseract non trovato, uso solo PaddleOCR")
            self.tesseract_available = False
        
        # PaddleOCR (primario)
        try:
            from paddleocr import PaddleOCR
            self.paddle_ocr = PaddleOCR(use_angle_cls=True, lang='it')
            logger.info("PaddleOCR inizializzato")
            self.paddle_available = True
        except Exception as e:
            logger.warning(f"PaddleOCR non disponibile: {e}")
            self.paddle_available = False
        
        # pix2tex per formule matematiche
        try:
            from pix2tex.cli import LatexOCR
            self.pix2tex_model = LatexOCR()
            logger.info("pix2tex inizializzato per formule LaTeX")
            self.pix2tex_available = True
        except Exception as e:
            logger.warning(f"pix2tex non disponibile: {e}")
            self.pix2tex_available = False
        
        # CLIP per embedding visivi
        try:
            import clip
            self.clip_model, self.clip_preprocess = clip.load("ViT-B/32")
            logger.info("CLIP inizializzato per embedding visivi")
            self.clip_available = True
        except Exception as e:
            logger.warning(f"CLIP non disponibile: {e}")
            self.clip_available = False
        
        # Qwen3-VL-2B-Q4 per caption avanzate
        try:
            from .qwen_vl_client import load_qwen_vl_model
            self.qwen_vl = load_qwen_vl_model(
                model_dir="./models",
                model_name="qwen3-vl-2b-q4.gguf",
                verbose=True
            )
            if self.qwen_vl:
                logger.info("Qwen3-VL-2B-Q4 inizializzato per caption avanzate")
                self.qwen_vl_available = True
            else:
                self.qwen_vl_available = False
        except Exception as e:
            logger.warning(f"Qwen3-VL non disponibile: {e}")
            self.qwen_vl_available = False
    
    def extract_text_paddle(self, image: np.ndarray) -> Tuple[str, List[Dict]]:
        """
        Estrae testo usando PaddleOCR
        
        Returns:
            Tuple[testo estratto, lista di bounding box con confidenza]
        """
        if not self.paddle_available:
            return "", []
        
        results = self.paddle_ocr.ocr(image, cls=True)
        
        text_lines = []
        boxes = []
        
        if results and results[0]:
            for box in results[0]:
                coords, (text, confidence) = box
                text_lines.append(text)
                boxes.append({
                    'bbox': coords,
                    'text': text,
                    'confidence': confidence
                })
        
        return "\n".join(text_lines), boxes
    
    def detect_formula(self, image: np.ndarray) -> Optional[str]:
        """
        Rileva se l'immagine contiene una formula matematica e la converte in LaTeX
        
        Returns:
            Formula in formato LaTeX o None se non rilevata
        """
        if not self.pix2tex_available:
            return None
        
        try:
            # Converte numpy array a PIL Image
            if len(image.shape) == 3:
                image_pil = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            else:
                image_pil = Image.fromarray(image)
            
            latex = self.pix2tex_model(image_pil)
            
            if latex and len(latex.strip()) > 5:  # Formula valida
                logger.info(f"Formula rilevata: {latex[:50]}...")
                return latex
        except Exception as e:
            logger.debug(f"Nessuna formula rilevata o errore: {e}")
        
        return None
    
    def get_clip_embedding(self, image: np.ndarray) -> Optional[np.ndarray]:
        """
        Genera embedding visivo usando CLIP
        
        Returns:
            Vettore di embedding o None
        """
        if not self.clip_available:
            return None
        
        try:
            image_pil = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            image_input = self.clip_preprocess(image_pil).unsqueeze(0)
            
            with torch.no_grad():
                embedding = self.clip_model.encode_image(image_input)
            
            return embedding.cpu().numpy().flatten()
        except Exception as e:
            logger.error(f"Errore CLIP embedding: {e}")
            return None
    
    def generate_advanced_caption(
        self, 
        image: np.ndarray, 
        ocr_text: str = "",
        latex_formula: Optional[str] = None
    ) -> str:
        """
        Genera caption avanzata usando Qwen3-VL-2B-Q4
        
        Logica:
        1. Se OCR ha abbastanza testo → usa OCR + template (NO VLM)
        2. Se è formula (pix2tex sicuro) → usa LaTeX + descrizione (NO VLM)
        3. Altrimenti → Qwen3-VL scrive descrizione ricca
        
        Args:
            image: Immagine come numpy array
            ocr_text: Testo estratto da OCR
            latex_formula: Formula LaTeX se rilevata
        
        Returns:
            Caption finale
        """
        image_pil = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        
        # Caso 1: Abbastanza testo OCR
        if ocr_text and len(ocr_text.split()) >= 10:
            logger.info("Caption generata da OCR (senza VLM)")
            return f"Immagine contenente testo: {ocr_text}"
        
        # Caso 2: Formula matematica
        if latex_formula:
            logger.info("Caption generata da formula LaTeX (senza VLM)")
            return f"Formula matematica: {latex_formula}"
        
        # Caso 3: Usa Qwen3-VL per descrizione ricca
        if self.qwen_vl_available:
            logger.info("Generazione caption con Qwen3-VL-2B-Q4")
            try:
                prompt = "Descrivi questa immagine in dettaglio, includendo elementi visivi, testo visibile, e il contesto generale."
                caption = self.qwen_vl.generate_caption(image_pil, prompt, max_tokens=256)
                return caption
            except Exception as e:
                logger.error(f"Errore Qwen-VL: {e}")
        
        # Fallback: descrizione base
        logger.warning("Fallback a descrizione base")
        return "Immagine senza testo significativo o formule rilevate"
    
    def process_image_complete(
        self, 
        image_path: str,
        lang: str = 'it+en'
    ) -> Dict[str, Any]:
        """
        Elabora completamente un'immagine con tutti i metodi disponibili
        
        Returns:
            Dizionario completo con:
            - tipo: "immagine"
            - percorso: path dell'immagine
            - libro: nome libro (da metadata)
            - pagina: numero pagina (da metadata)
            - caption: descrizione finale
            - testo_ocr: testo da OCR
            - latex: formula LaTeX se presente
            - clip_id: ID embedding CLIP
        """
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Impossibile caricare immagine: {image_path}")
        
        # 1. OCR con PaddleOCR
        ocr_text, ocr_boxes = self.extract_text_paddle(image)
        
        # Fallback a Tesseract se Paddle fallisce
        if not ocr_text and self.tesseract_available:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            ocr_text = pytesseract.image_to_string(gray, lang=lang.replace('+', ' '))
        
        # 2. Rilevamento formule con pix2tex
        latex_formula = self.detect_formula(image)
        
        # 3. Embedding CLIP
        clip_embedding = self.get_clip_embedding(image)
        clip_id = hash(clip_embedding.tobytes()) if clip_embedding is not None else None
        
        # 4. Genera caption intelligente
        caption = self.generate_advanced_caption(image, ocr_text, latex_formula)
        
        result = {
            'tipo': 'immagine',
            'percorso': str(image_path),
            'libro': None,  # Da impostare dal chiamante
            'pagina': None,  # Da impostare dal chiamante
            'caption': caption,
            'testo_ocr': ocr_text,
            'latex': latex_formula,
            'clip_id': clip_id,
            'ocr_boxes': ocr_boxes,
            'clip_embedding': clip_embedding
        }
        
        logger.info(f"Immagine elaborata: {image_path}")
        logger.info(f"  - OCR: {len(ocr_text)} caratteri")
        logger.info(f"  - LaTeX: {'presente' if latex_formula else 'assente'}")
        logger.info(f"  - CLIP ID: {clip_id}")
        logger.info(f"  - Caption: {caption[:80]}...")
        
        return result
    
    def extract_text_from_image(
        self, 
        image_path: str, 
        lang: str = 'ita+eng',
        preprocess: bool = True
    ) -> str:
        """
        Metodo legacy per compatibilità - Estrae testo da immagine
        """
        result = self.process_image_complete(image_path, lang)
        return result['testo_ocr']


# Import torch solo se necessario
try:
    import torch
except ImportError:
    torch = None
    logger.warning("PyTorch non disponibile - alcune funzionalità potrebbero non funzionare")


# Classe legacy per compatibilità
LocalOCR = AdvancedOCRProcessor


if __name__ == "__main__":
    print("Test modulo OCR avanzato")
    print("=" * 60)
    
    processor = AdvancedOCRProcessor()
    
    print("\nComponenti disponibili:")
    print(f"  ✓ Tesseract: {processor.tesseract_available}")
    print(f"  ✓ PaddleOCR: {processor.paddle_available}")
    print(f"  ✓ pix2tex: {processor.pix2tex_available}")
    print(f"  ✓ CLIP: {processor.clip_available}")
    print(f"  ✓ Qwen3-VL-2B-Q4: {processor.qwen_vl_available}")
    
    print("\nPer testare l'elaborazione completa:")
    print("  processor.process_image_complete('tua_immagine.png')")
