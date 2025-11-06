import { Router } from 'express';
import exportService from '../../services/export';
import storage from '../../services/storage';

const router = Router();

// Export subdomains
router.get('/programs/:programId/subdomains', async (req, res) => {
  try {
    const { programId } = req.params;
    const { format = 'csv' } = req.query;

    const exports = await exportService.exportSubdomains(programId);
    const url = format === 'txt' ? exports.txt : exports.csv;

    // Generate presigned URL for download
    const downloadUrl = await storage.getPresignedUrl(storage.parseS3Uri(url), 3600);

    res.json({ downloadUrl, format });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Export URLs
router.get('/programs/:programId/urls', async (req, res) => {
  try {
    const { programId } = req.params;
    const { format = 'csv' } = req.query;

    const exports = await exportService.exportUrls(programId);
    const url = format === 'txt' ? exports.txt : exports.csv;

    const downloadUrl = await storage.getPresignedUrl(storage.parseS3Uri(url), 3600);

    res.json({ downloadUrl, format });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Export findings
router.get('/programs/:programId/findings', async (req, res) => {
  try {
    const { programId } = req.params;

    const csvUrl = await exportService.exportFindings(programId);
    const downloadUrl = await storage.getPresignedUrl(storage.parseS3Uri(csvUrl), 3600);

    res.json({ downloadUrl, format: 'csv' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Export fuzzing results
router.get('/jobs/:jobId/fuzzing', async (req, res) => {
  try {
    const { jobId } = req.params;

    const csvUrl = await exportService.exportFuzzingResults(jobId);
    const downloadUrl = await storage.getPresignedUrl(storage.parseS3Uri(csvUrl), 3600);

    res.json({ downloadUrl, format: 'csv' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Export PoC for finding
router.get('/findings/:findingId/poc', async (req, res) => {
  try {
    const { findingId } = req.params;
    const { format = 'markdown' } = req.query;

    const pocs = await exportService.exportPoC(findingId);
    const url = format === 'txt' ? pocs.txt : pocs.markdown;

    const downloadUrl = await storage.getPresignedUrl(storage.parseS3Uri(url), 3600);

    res.json({ downloadUrl, format });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Export all data for a program
router.get('/programs/:programId/all', async (req, res) => {
  try {
    const { programId } = req.params;

    const exports = await exportService.exportAll(programId);

    // Generate presigned URLs for all exports
    const downloadUrls = {
      subdomains: {
        txt: await storage.getPresignedUrl(storage.parseS3Uri(exports.subdomains.txt), 3600),
        csv: await storage.getPresignedUrl(storage.parseS3Uri(exports.subdomains.csv), 3600),
      },
      urls: {
        txt: await storage.getPresignedUrl(storage.parseS3Uri(exports.urls.txt), 3600),
        csv: await storage.getPresignedUrl(storage.parseS3Uri(exports.urls.csv), 3600),
      },
      findings: await storage.getPresignedUrl(storage.parseS3Uri(exports.findings), 3600),
      exportedAt: exports.exportedAt,
    };

    res.json(downloadUrls);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
