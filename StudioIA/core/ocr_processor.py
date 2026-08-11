"""
OCR Module - Riconoscimento ottico dei caratteri usando OpenCV e Tesseract
Funziona completamente in locale senza AI
"""

import cv2
import numpy as np
import pytesseract
from pathlib import Path
from typing import Optional, List
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class LocalOCR:
    """Classe per l'elaborazione OCR locale di immagini e appunti"""
    
    def __init__(self, tesseract_cmd: Optional[str] = None):
        """
        Inizializza il motore OCR
        
        Args:
            tesseract_cmd: Percorso personalizzato per tesseract (opzionale)
        """
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        
        # Verifica che tesseract sia installato
        try:
            pytesseract.get_tesseract_version()
            logger.info("Tesseract OCR inizializzato con successo")
        except Exception as e:
            logger.error(f"Tesseract non trovato: {e}")
            raise RuntimeError(
                "Tesseract OCR non è installato. "
                "Installa con: sudo apt-get install tesseract-ocr (Linux) "
                "o scarica da https://github.com/tesseract-ocr/tesseract"
            )
    
    def preprocess_image(self, image: np.ndarray) -> np.ndarray:
        """
        Pre-elabora l'immagine per migliorare il riconoscimento OCR
        
        Args:
            image: Immagine come array numpy
            
        Returns:
            Immagine pre-elaborata
        """
        # Converti in scala di grigi se necessario
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        # Applica thresholding per migliorare il contrasto
        _, thresh = cv2.threshold(
            gray, 0, 255, 
            cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        
        # Rimuovi rumore con morfologia
        kernel = np.ones((1, 1), np.uint8)
        denoised = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        
        # Migliora i bordi del testo
        edges = cv2.Canny(denoised, 50, 150, apertureSize=3)
        
        return denoised
    
    def detect_document_boundaries(self, image: np.ndarray) -> Optional[np.ndarray]:
        """
        Rileva i confini del documento nell'immagine
        
        Args:
            image: Immagine originale
            
        Returns:
            Immagine ritagliata del documento o None se non rilevato
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edged = cv2.Canny(blurred, 75, 200)
        
        # Trova contorni
        contours, _ = cv2.findContours(
            edged.copy(), 
            cv2.RETR_EXTERNAL, 
            cv2.CHAIN_APPROX_SIMPLE
        )
        
        # Ordina contorni per area (dal più grande)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)
        
        for contour in contours:
            perimeter = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
            
            # Se il contorno ha 4 punti, probabilmente è un documento
            if len(approx) == 4:
                x, y, w, h = cv2.boundingRect(approx)
                return image[y:y+h, x:x+w]
        
        return None
    
    def extract_text_from_image(
        self, 
        image_path: str, 
        lang: str = 'ita+eng',
        preprocess: bool = True
    ) -> str:
        """
        Estrae testo da un'immagine usando OCR
        
        Args:
            image_path: Percorso dell'immagine
            lang: Lingue per il riconoscimento (default: italiano+inglese)
            preprocess: Se applicare pre-processing
            
        Returns:
            Testo estratto
        """
        try:
            # Carica immagine
            image = cv2.imread(str(image_path))
            if image is None:
                raise ValueError(f"Impossibile caricare l'immagine: {image_path}")
            
            # Rileva e ritaglia documento se presente
            cropped = self.detect_document_boundaries(image)
            if cropped is not None:
                image = cropped
                logger.info("Documento rilevato e ritagliato")
            
            # Pre-processing opzionale
            if preprocess:
                image = self.preprocess_image(image)
            
            # Esegui OCR
            text = pytesseract.image_to_string(image, lang=lang)
            
            logger.info(f"OCR completato: {len(text)} caratteri estratti")
            return text.strip()
            
        except Exception as e:
            logger.error(f"Errore OCR: {e}")
            return ""
    
    def extract_text_from_images(
        self, 
        image_paths: List[str], 
        lang: str = 'ita+eng'
    ) -> str:
        """
        Estrae testo da multiple immagini
        
        Args:
            image_paths: Lista di percorsi delle immagini
            lang: Lingue per il riconoscimento
            
        Returns:
            Testo combinato da tutte le immagini
        """
        all_text = []
        
        for img_path in image_paths:
            text = self.extract_text_from_image(img_path, lang)
            if text:
                all_text.append(text)
        
        return "\n\n---\n\n".join(all_text)
    
    def extract_text_from_bytes(
        self, 
        image_bytes: bytes, 
        lang: str = 'ita+eng',
        preprocess: bool = True
    ) -> str:
        """
        Estrae testo da dati immagine in formato bytes
        
        Args:
            image_bytes: Dati immagine come bytes
            lang: Lingue per il riconoscimento
            preprocess: Se applicare pre-processing
            
        Returns:
            Testo estratto
        """
        try:
            # Converte bytes in array numpy
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                raise ValueError("Impossibile decodificare l'immagine")
            
            # Rileva e ritaglia documento se presente
            cropped = self.detect_document_boundaries(image)
            if cropped is not None:
                image = cropped
            
            # Pre-processing opzionale
            if preprocess:
                image = self.preprocess_image(image)
            
            # Esegui OCR
            text = pytesseract.image_to_string(image, lang=lang)
            
            logger.info(f"OCR da bytes completato: {len(text)} caratteri")
            return text.strip()
            
        except Exception as e:
            logger.error(f"Errore OCR da bytes: {e}")
            return ""
    
    def get_confidence_map(self, image_path: str, lang: str = 'ita+eng') -> dict:
        """
        Ottiene informazioni dettagliate sull'OCR con livelli di confidenza
        
        Args:
            image_path: Percorso dell'immagine
            lang: Lingue per il riconoscimento
            
        Returns:
            Dizionario con parole, bounding box e confidenza
        """
        image = cv2.imread(str(image_path))
        if image is None:
            return {}
        
        if self.preprocess:
            image = self.preprocess_image(image)
        
        # Ottieni dati dettagliati
        data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)
        
        results = {
            'text': [],
            'conf': [],
            'bbox': []
        }
        
        n_boxes = len(data['text'])
        for i in range(n_boxes):
            if int(data['conf'][i]) > 0:  # Solo risultati con confidenza > 0
                results['text'].append(data['text'][i])
                results['conf'].append(data['conf'][i])
                results['bbox'].append({
                    'x': data['left'][i],
                    'y': data['top'][i],
                    'w': data['width'][i],
                    'h': data['height'][i]
                })
        
        return results


# Funzione utility per elaborazione batch
def process_notes_batch(
    image_folder: str, 
    output_file: Optional[str] = None,
    lang: str = 'ita+eng'
) -> str:
    """
    Elabora tutte le immagini in una cartella come appunti
    
    Args:
        image_folder: Percorso della cartella con le immagini
        output_file: File opzionale dove salvare il testo estratto
        lang: Lingue per il riconoscimento
        
    Returns:
        Testo combinato da tutte le immagini
    """
    ocr = LocalOCR()
    folder = Path(image_folder)
    
    # Trova tutte le immagini
    image_extensions = ['*.jpg', '*.jpeg', '*.png', '*.bmp', '*.tiff']
    image_files = []
    
    for ext in image_extensions:
        image_files.extend(folder.glob(ext))
    
    if not image_files:
        logger.warning(f"Nessuna immagine trovata in {image_folder}")
        return ""
    
    # Estrai testo da tutte le immagini
    combined_text = ocr.extract_text_from_images(
        [str(f) for f in image_files], 
        lang=lang
    )
    
    # Salva su file se richiesto
    if output_file and combined_text:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(combined_text)
        logger.info(f"Testo salvato in {output_file}")
    
    return combined_text


if __name__ == "__main__":
    # Test del modulo
    print("Test modulo OCR locale")
    print("=" * 50)
    
    # Verifica installazione
    try:
        ocr = LocalOCR()
        print("✓ Tesseract OCR disponibile")
    except RuntimeError as e:
        print(f"✗ Errore: {e}")
        print("Installa Tesseract prima di usare questo modulo")
