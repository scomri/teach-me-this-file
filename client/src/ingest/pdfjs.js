// pdf.js for the browser, with its worker served from this origin. Imported dynamically
// by the PDF reader, so the library stays out of the initial bundle.
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export default pdfjs;
