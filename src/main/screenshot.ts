import { desktopCapturer } from 'electron';
import { getMainWindow, getPrimaryDisplay, hideWindow, showAndFocusWindow } from './window-manager';

/**
 * Validates and cleans base64 data URL
 * @param dataUrl - The data URL to validate and clean
 * @returns Cleaned data URL or null if invalid
 */
export function validateAndCleanBase64(dataUrl: string): string | null {
  try {
    // Check if it's a valid data URL format
    if (!dataUrl.startsWith('data:image/')) {
      console.error('[Screenshot] Invalid data URL format');
      return null;
    }

    // Split and extract the base64 component
    const parts = dataUrl.split(';base64,');
    if (parts.length !== 2) {
      console.error('[Screenshot] Could not extract base64 part');
      return null;
    }

    const [prefix, encodedData] = parts;
    
    // Clean the encoded data by removing any non-base64 characters
    // Base64 uses A-Z, a-z, 0-9, +, / and = for padding
    let cleanedData = encodedData.replace(/[^A-Za-z0-9+/=]/g, '');
    
    // Ensure proper padding (length must be multiple of 4)
    const padding = cleanedData.length % 4;
    if (padding) {
      // Add missing padding characters
      cleanedData += '='.repeat(4 - padding);
    }
    
    // Log if cleaning was necessary
    if (cleanedData !== encodedData) {
      console.warn('[Screenshot] Base64 data was cleaned');
    }
    
    // Return the cleaned URL
    return `${prefix};base64,${cleanedData}`;
  } catch (error) {
    console.error('[Screenshot] Error validating base64 data:', error);
    return null;
  }
}

/**
 * Captures a screenshot of the primary display
 * @returns Promise resolving to a base64 data URL of the screenshot or null if failed
 */
export async function captureScreenshot(): Promise<string | null> {
  try {
    // Hide the window before taking screenshot
    hideWindow();
    
    // Wait a short moment for the window to actually hide
    await new Promise(resolve => setTimeout(resolve, 50));

    const primaryDisplay = getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { 
        width: primaryDisplay.size.width, 
        height: primaryDisplay.size.height 
      }
    });
    
    const primarySource = sources.find(source => 
      source.display_id === primaryDisplay.id.toString() || 
      source.id.startsWith('screen:')
    );

    if (!primarySource) {
      console.error('[Screenshot] Primary screen source not found');
      return null;
    }

    // First capture and resize image
    const originalImage = primarySource.thumbnail;
    const originalSize = originalImage.getSize();
    const maxDimension = 1024; // Max width or height

    let newWidth, newHeight;
    if (originalSize.width > originalSize.height) {
      newWidth = Math.min(originalSize.width, maxDimension);
      newHeight = Math.round(newWidth / originalSize.width * originalSize.height);
    } else {
      newHeight = Math.min(originalSize.height, maxDimension);
      newWidth = Math.round(newHeight / originalSize.height * originalSize.width);
    }

    // Ensure dimensions are at least 1x1
    newWidth = Math.max(1, newWidth);
    newHeight = Math.max(1, newHeight);

    console.log(`[Screenshot] Resizing from ${originalSize.width}x${originalSize.height} to ${newWidth}x${newHeight}`);

    // Resize (quality 'good' is default)
    const resizedImage = originalImage.resize({ 
      width: newWidth, 
      height: newHeight, 
      quality: 'good' 
    });
    
    // Process directly to base64
    const pngBuffer = resizedImage.toPNG();
    const base64Data = pngBuffer.toString('base64');
    let screenshotDataUrl = `data:image/png;base64,${base64Data}`;
    
    console.log('[Screenshot] Captured and encoded to base64');
    
    // Validate and clean the base64 data before returning
    const validatedScreenshotDataUrl = validateAndCleanBase64(screenshotDataUrl);
    if (validatedScreenshotDataUrl) {
      screenshotDataUrl = validatedScreenshotDataUrl;
      console.log('[Screenshot] Data validated successfully');
    } else {
      console.error('[Screenshot] Data validation failed, using original data');
    }

    return screenshotDataUrl;
  } catch (error) {
    console.error('[Screenshot] Failed to capture screen:', error);
    return null;
  } finally {
    // IMPORTANT: Ensure the window is shown again even if errors occurred
    showAndFocusWindow();
    console.log('[Screenshot] Window shown again');
  }
} 