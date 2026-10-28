import { ThumbCache } from '../state/thumbs';
// A separate view of camera originals; editor print thumbnails never replace it.
// The existing queue bounds native decoding to two requests at a time.
export const libraryThumbs = new ThumbCache();
