"""
appunti2pdf/converter.py
-------------------------
Converte appunti (immagini) in PDF usando OpenCV avanzato per il pre-processing
e Tesseract OCR ottimizzato per testo manoscritto. Tutto in locale senza AI esterna.
Include rilevamento intelligente di blocchi di testo e collegamenti tra sezioni.
"""

import cv2
import numpy as np
import pytesseract
from pathlib import Path
from typing import List, Optional, Tuple, Dict
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AppuntiToPDFConverter:
    """Classe per convertire immagini di appunti in PDF con OCR avanzato per manoscritto"""
    
    def __init__(self, tesseract_cmd: Optional[str] = None):
        """
        Inizializza il convertitore con configurazioni ottimizzate per appunti
        
        Args:
            tesseract_cmd: Percorso personalizzato per tesseract (opzionale)
        """
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        
        # Verifica che tesseract sia installato
        try:
            pytesseract.get_tesseract_version()
            logger.info("Tesseract OCR inizializzato per appunti2pdf")
        except Exception as e:
            logger.error(f"Tesseract non trovato: {e}")
            raise RuntimeError(
                "Tesseract OCR non è installato. "
                "Installa con: sudo apt-get install tesseract-ocr (Linux) "
                "o scarica da https://github.com/tesseract-ocr/tesseract"
            )
    
    def detect_text_blocks(self, image: np.ndarray) -> List[Dict]:
        """
        Rileva blocchi di testo nell'immagine usando tecniche avanzate di computer vision
        per identificare anche blocchi non contornati e collegamenti tra sezioni
        
        Args:
            image: Immagine come array numpy
            
        Returns:
            Lista di dizionari con coordinate e informazioni sui blocchi di testo
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image.copy()
        
        # Migliora contrasto con CLAHE (Contrast Limited Adaptive Histogram Equalization)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        
        # Applica multiple soglie per catturare diversi tipi di scrittura
        _, thresh1 = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        thresh2 = cv2.adaptiveThreshold(
            enhanced, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            blockSize=15,
            C=7
        )
        
        # Combina le soglie
        combined_thresh = cv2.bitwise_or(thresh1, thresh2)
        
        # Rimuovi rumore con morphological operations avanzate
        kernel_horizontal = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1))
        kernel_vertical = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 25))
        
        # Rileva linee orizzontali e verticali (per tabelle o strutture)
        horizontal_lines = cv2.morphologyEx(combined_thresh, cv2.MORPH_OPEN, kernel_horizontal, iterations=2)
        vertical_lines = cv2.morphologyEx(combined_thresh, cv2.MORPH_OPEN, kernel_vertical, iterations=2)
        
        # Unisci linee per creare una struttura
        structure = cv2.addWeighted(horizontal_lines, 0.5, vertical_lines, 0.5, 0)
        _, structure = cv2.threshold(structure, 0, 255, cv2.THRESH_BINARY)
        
        # Sottrai la struttura per isolare il testo
        text_region = cv2.subtract(combined_thresh, structure)
        
        # Trova contorni per identificare blocchi di testo
        contours, _ = cv2.findContours(text_region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        blocks = []
        min_area = 500  # Area minima per considerare un blocco di testo
        
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > min_area:
                x, y, w, h = cv2.boundingRect(contour)
                
                # Filtra blocchi troppo stretti o alti (probabilmente rumore)
                if w > 20 and h > 20:
                    blocks.append({
                        'x': x,
                        'y': y,
                        'w': w,
                        'h': h,
                        'area': area,
                        'type': 'text_block'
                    })
        
        # Ordina blocchi dall'alto verso il basso, poi da sinistra a destra
        blocks.sort(key=lambda b: (b['y'] // 50 * 50, b['x']))
        
        return blocks
    
    def connect_text_blocks(self, blocks: List[Dict], image_shape: Tuple) -> List[List[Dict]]:
        """
        Collega blocchi di testo correlati basandosi su prossimità e allineamento
        per ricostruire il flusso logico degli appunti
        
        Args:
            blocks: Lista di blocchi di testo rilevati
            image_shape: Forma dell'immagine originale
            
        Returns:
            Lista di gruppi di blocchi collegati
        """
        if not blocks:
            return []
        
        height = image_shape[0]
        connected_groups = []
        used = set()
        
        for i, block in enumerate(blocks):
            if i in used:
                continue
            
            current_group = [block]
            used.add(i)
            
            # Cerca blocchi vicini da collegare
            for j, other_block in enumerate(blocks):
                if j in used:
                    continue
                
                # Calcola distanza e sovrapposizione
                dx = abs(block['x'] - other_block['x'])
                dy = abs(block['y'] - other_block['y'])
                
                # Due blocchi sono collegati se sono vicini verticalmente o orizzontalmente
                vertical_proximity = dy < block['h'] * 1.5
                horizontal_alignment = dx < block['w'] * 0.5
                
                if vertical_proximity or horizontal_alignment:
                    current_group.append(other_block)
                    used.add(j)
            
            connected_groups.append(current_group)
        
        return connected_groups
    
    def preprocess_appunto_image(self, image: np.ndarray) -> Tuple[np.ndarray, str]:
        """
        Pre-elabora un'immagine di appunti ed estrae il testo con OCR avanzato
        Ottimizzato per testo manoscritto e layout complessi
        
        Args:
            image: Immagine come array numpy
            
        Returns:
            Tuple (immagine_pre_elaborata, testo_estratto)
        """
        # Converti in scala di grigi se necessario
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        # Migliora contrasto con CLAHE
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        
        # Denoising avanzato
        denoised = cv2.fastNlMeansDenoising(enhanced, None, h=15, templateWindowSize=7, searchWindowSize=21)
        
        # Rileva blocchi di testo
        text_blocks = self.detect_text_blocks(image)
        
        # Se ci sono blocchi, processali separatamente per migliore accuratezza
        if text_blocks:
            connected_groups = self.connect_text_blocks(text_blocks, image.shape)
            full_text = []
            
            for group in connected_groups:
                # Estrai regione di interesse per ogni gruppo
                group_x = min(b['x'] for b in group)
                group_y = min(b['y'] for b in group)
                group_w = max(b['x'] + b['w'] for b in group) - group_x
                group_h = max(b['y'] + b['h'] for b in group) - group_y
                
                # Aggiungi margine
                margin = 10
                roi_x = max(0, group_x - margin)
                roi_y = max(0, group_y - margin)
                roi_w = min(image.shape[1] - roi_x, group_w + 2 * margin)
                roi_h = min(image.shape[0] - roi_y, group_h + 2 * margin)
                
                roi = denoised[roi_y:roi_y+roi_h, roi_x:roi_x+roi_w]
                
                # Applica thresholding adattivo sulla ROI
                roi_thresh = cv2.adaptiveThreshold(
                    roi, 255,
                    cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                    cv2.THRESH_BINARY,
                    blockSize=11,
                    C=5
                )
                
                # Esegui OCR sulla ROI con configurazione ottimizzata per manoscritto
                try:
                    custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?\-\(\)[]{}\'\" "'
                    text = pytesseract.image_to_string(roi_thresh, lang='ita+eng', config=custom_config)
                    full_text.append(text.strip())
                except Exception as e:
                    logger.warning(f"OCR fallito su blocco: {e}")
            
            extracted_text = '\n\n'.join(full_text)
            
            # Crea immagine composita con tutti i blocchi evidenziati
            composite = cv2.cvtColor(denoised, cv2.COLOR_GRAY2BGR)
            for block in text_blocks:
                cv2.rectangle(
                    composite,
                    (block['x'], block['y']),
                    (block['x'] + block['w'], block['y'] + block['h']),
                    (0, 255, 0),
                    2
                )
            
            return composite, extracted_text
        
        else:
            # Fallback: processa l'intera immagine
            thresh = cv2.adaptiveThreshold(
                denoised, 255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                blockSize=11,
                C=5
            )
            
            # Configurazione PSM 6 per blocchi di testo uniformi (ottimo per manoscritto)
            try:
                custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?\-\(\)[]{}\'\" "'
                text = pytesseract.image_to_string(thresh, lang='ita+eng', config=custom_config)
            except Exception as e:
                logger.warning(f"OCR fallito: {e}")
                text = ""
            
            return thresh, text.strip()
    
    def convert_images_to_pdf(
        self,
        image_paths: List[str],
        output_pdf_path: str,
        add_ocr_text: bool = True,
        lang: str = 'ita+eng'
    ) -> bool:
        """
        Converte una lista di immagini in un singolo PDF
        
        Args:
            image_paths: Lista di percorsi delle immagini
            output_pdf_path: Percorso del file PDF di output
            add_ocr_text: Se aggiungere il testo OCR come metadata invisibile
            lang: Lingue per l'OCR
            
        Returns:
            True se la conversione è riuscita, False altrimenti
        """
        try:
            if not image_paths:
                logger.error("Nessuna immagine fornita")
                return False
            
            # Crea il PDF
            c = canvas.Canvas(output_pdf_path, pagesize=A4)
            width, height = A4
            
            extracted_texts = []
            
            for i, img_path in enumerate(image_paths):
                try:
                    # Carica immagine
                    image = cv2.imread(str(img_path))
                    if image is None:
                        logger.warning(f"Impossibile caricare: {img_path}")
                        continue
                    
                    # Pre-elabora ed estrai testo
                    processed_img, ocr_text = self.preprocess_appunto_image(image)
                    
                    if add_ocr_text and ocr_text:
                        extracted_texts.append(f"--- Pagina {i+1} ---\n{ocr_text}")
                    
                    # Salva immagine temporanea per ReportLab
                    temp_path = f"/tmp/appunto_page_{i}.png"
                    cv2.imwrite(temp_path, processed_img)
                    
                    # Aggiungi pagina al PDF
                    if i > 0:
                        c.showPage()
                    
                    # Inserisci immagine scalata per adattarla ad A4
                    img_reader = ImageReader(temp_path)
                    c.drawImage(
                        img_reader,
                        x=20, y=20,
                        width=width-40,
                        height=height-40,
                        preserveAspectRatio=True
                    )
                    
                    # Aggiungi testo OCR come metadata nascosto
                    if add_ocr_text and ocr_text:
                        c.setAuthor(f"OCR Page {i+1}")
                        c.setSubject(ocr_text[:100])
                    
                except Exception as e:
                    logger.error(f"Errore elaborazione immagine {img_path}: {e}")
                    continue
            
            # Salva il PDF
            c.save()
            
            # Salva anche un file di testo separato con tutto l'OCR
            if extracted_texts and add_ocr_text:
                txt_path = output_pdf_path.replace('.pdf', '_ocr.txt')
                with open(txt_path, 'w', encoding='utf-8') as f:
                    f.write('\n\n'.join(extracted_texts))
                logger.info(f"Testo OCR salvato in: {txt_path}")
            
            logger.info(f"PDF creato con successo: {output_pdf_path}")
            return True
            
        except Exception as e:
            logger.error(f"Errore nella conversione PDF: {e}")
            return False
    
    def convert_folder_to_pdf(
        self,
        folder_path: str,
        output_pdf_path: str,
        add_ocr_text: bool = True,
        lang: str = 'ita+eng'
    ) -> bool:
        """
        Converte tutte le immagini in una cartella in un singolo PDF
        
        Args:
            folder_path: Percorso della cartella con le immagini
            output_pdf_path: Percorso del file PDF di output
            add_ocr_text: Se aggiungere il testo OCR
            lang: Lingue per l'OCR
            
        Returns:
            True se la conversione è riuscita, False altrimenti
        """
        folder = Path(folder_path)
        
        if not folder.exists():
            logger.error(f"Cartella non esistente: {folder_path}")
            return False
        
        # Trova tutte le immagini
        image_extensions = ['*.jpg', '*.jpeg', '*.png', '*.bmp', '*.tiff']
        image_files = []
        
        for ext in image_extensions:
            image_files.extend(sorted(folder.glob(ext)))
        
        if not image_files:
            logger.warning(f"Nessuna immagine trovata in {folder_path}")
            return False
        
        logger.info(f"Trovate {len(image_files)} immagini da convertire")
        
        return self.convert_images_to_pdf(
            [str(f) for f in image_files],
            output_pdf_path,
            add_ocr_text=add_ocr_text,
            lang=lang
        )


# Funzione utility per uso rapido
def convert_appunti_to_pdf(
    input_path: str,
    output_pdf: str,
    add_ocr: bool = True
) -> bool:
    """
    Funzione rapida per convertire immagini o cartella in PDF
    
    Args:
        input_path: Percorso di un'immagine o cartella
        output_pdf: Percorso del PDF di output
        add_ocr: Se eseguire OCR e includere testo
        
    Returns:
        True se successo, False altrimenti
    """
    converter = AppuntiToPDFConverter()
    
    input_p = Path(input_path)
    
    if input_p.is_file():
        return converter.convert_images_to_pdf(
            [str(input_p)],
            output_pdf,
            add_ocr_text=add_ocr
        )
    elif input_p.is_dir():
        return converter.convert_folder_to_pdf(
            str(input_p),
            output_pdf,
            add_ocr_text=add_ocr
        )
    else:
        logger.error(f"Percorso non valido: {input_path}")
        return False


if __name__ == "__main__":
    # Test del modulo
    print("Test modulo Appunti2PDF")
    print("=" * 50)
    
    try:
        converter = AppuntiToPDFConverter()
        print("✓ Convertitore inizializzato con successo")
    except RuntimeError as e:
        print(f"✗ Errore: {e}")
        print("Installa Tesseract prima di usare questo modulo")
