import os
import cv2

# Paths
video_folder = os.path.join(os.path.dirname(__file__), "video")
thumbnail_folder = os.path.join(video_folder, "thumbnail")

# Ensure thumbnail folder exists
os.makedirs(thumbnail_folder, exist_ok=True)

# Supported video extensions
video_extensions = ('.mp4', '.avi', '.mkv', '.mov', '.wmv', '.webm')

# Get all video files
video_files = [f for f in os.listdir(video_folder) 
               if os.path.isfile(os.path.join(video_folder, f)) 
               and f.lower().endswith(video_extensions)]

print(f"Found {len(video_files)} video files")

for video_file in video_files:
    video_path = os.path.join(video_folder, video_file)
    
    # Output thumbnail path (same name but .jpg)
    thumbnail_name = os.path.splitext(video_file)[0] + ".jpg"
    thumbnail_path = os.path.join(thumbnail_folder, thumbnail_name)
    
    # Open video
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        print(f"Error: Could not open {video_file}")
        continue
    
    # Get total frame count
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    if total_frames == 0:
        print(f"Error: No frames in {video_file}")
        cap.release()
        continue
    
    # Calculate middle frame
    middle_frame = total_frames // 2
    
    # Seek to middle frame
    cap.set(cv2.CAP_PROP_POS_FRAMES, middle_frame)
    
    # Read the frame
    ret, frame = cap.read()
    
    if ret:
        # Save as JPG (overwrites existing file if present)
        if os.path.exists(thumbnail_path):
            os.remove(thumbnail_path)
        cv2.imwrite(thumbnail_path, frame)
        print(f"Created: {thumbnail_name}")
    else:
        print(f"Error: Could not read middle frame from {video_file}")
    
    cap.release()

print("\nDone! Thumbnails saved to:", thumbnail_folder)
