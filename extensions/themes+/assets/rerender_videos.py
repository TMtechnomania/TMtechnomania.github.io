import os
import subprocess

# Paths
script_dir = os.path.dirname(__file__)
video_folder = os.path.join(script_dir, "video")
output_folder = os.path.join(script_dir, "testExport")

# Ensure output folder exists
os.makedirs(output_folder, exist_ok=True)

# Supported video extensions
video_extensions = ('.mp4', '.avi', '.mkv', '.mov', '.wmv', '.webm')

# Settings
TARGET_FPS = 24
# NVENC quality: CQ mode with value 19-23 ≈ 90% quality (lower = better, 0-51 range)
QUALITY_CQ = 20  # Constant Quality mode for NVENC (~90% quality)

def rerender_video(input_path, output_path):
    """Re-render video with same resolution, 24fps, and 90% quality using NVIDIA GPU"""
    
    # FFmpeg command with NVIDIA NVENC GPU encoding:
    # -hwaccel cuda: use CUDA for hardware acceleration
    # -i: input file
    # -r: output framerate
    # -c:v h264_nvenc: NVIDIA NVENC H.264 encoder (GPU accelerated)
    # -cq: Constant Quality mode (similar to CRF, ~20 for 90% quality)
    # -preset p4: NVENC preset (p1=fastest to p7=slowest/best quality)
    # -c:a aac: AAC audio codec
    # -b:a 128k: audio bitrate
    # -y: overwrite output file if exists
    
    cmd = [
        'ffmpeg',
        '-hwaccel', 'cuda',
        '-i', input_path,
        '-r', str(TARGET_FPS),
        '-c:v', 'h264_nvenc',
        '-cq', str(QUALITY_CQ),
        '-preset', 'p4',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-y',
        output_path
    ]
    
    print(f"Processing: {os.path.basename(input_path)}")
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"  ✓ Success: {os.path.basename(output_path)}")
            return True
        else:
            print(f"  ✗ Error: {result.stderr}")
            return False
    except FileNotFoundError:
        print("Error: FFmpeg not found. Please install FFmpeg and add it to PATH.")
        return False

def process_single_video(filename):
    """Process a single video file"""
    input_path = os.path.join(video_folder, filename)
    
    if not os.path.exists(input_path):
        print(f"Error: File not found: {input_path}")
        return False
    
    # Output with same name but ensure .mp4 extension
    output_name = os.path.splitext(filename)[0] + ".mp4"
    output_path = os.path.join(output_folder, output_name)
    
    return rerender_video(input_path, output_path)

def process_all_videos():
    """Process all video files in the video folder"""
    video_files = [f for f in os.listdir(video_folder) 
                   if os.path.isfile(os.path.join(video_folder, f)) 
                   and f.lower().endswith(video_extensions)]
    
    print(f"Found {len(video_files)} video files")
    print(f"Output folder: {output_folder}")
    print(f"Settings: {TARGET_FPS} FPS, CQ {QUALITY_CQ} (~90% quality), NVIDIA GPU encoding")
    print("-" * 50)
    
    success_count = 0
    for video_file in video_files:
        if process_single_video(video_file):
            success_count += 1
    
    print("-" * 50)
    print(f"Completed: {success_count}/{len(video_files)} videos processed successfully")

if __name__ == "__main__":
    # Process all videos with GPU encoding
    process_all_videos()
    
    # To process a single test file, uncomment below:
    # test_file = "anime-girl-katana.mp4"
    # print("=== TEST MODE (NVIDIA GPU Encoding) ===")
    # print(f"Processing single file: {test_file}")
    # print(f"Output folder: {output_folder}")
    # print(f"Settings: {TARGET_FPS} FPS, CQ {QUALITY_CQ} (~90% quality), NVIDIA GPU encoding")
    # print("-" * 50)
    # process_single_video(test_file)
