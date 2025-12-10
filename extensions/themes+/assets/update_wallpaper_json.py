import os
import json

# Paths
script_dir = os.path.dirname(__file__)
video_folder = os.path.join(script_dir, "video")
json_path = os.path.join(script_dir, "wallpaper.json")

# Base URL for assets
base_url = "https://buildwithkt.dev/extensions/themes+/assets"

# Supported video extensions
video_extensions = ('.mp4', '.avi', '.mkv', '.mov', '.wmv', '.webm')

# Get all video files (excluding thumbnail folder)
video_files = [f for f in os.listdir(video_folder) 
               if os.path.isfile(os.path.join(video_folder, f)) 
               and f.lower().endswith(video_extensions)]

# Category keywords for sorting
categories = {
    "anime": ["anime", "arona", "bocchi", "blue-archive", "chainsaw", "cowboy-bebop", "demon-slayer", 
              "evangelion", "goku", "hatsune", "itachi", "jujutsu", "kimetsu", "luffy", "miku", 
              "momo", "naruto", "neko", "neon-genesis", "one-piece", "okarun", "shinobu", "zenitsu",
              "wuthering-waves", "zenless-zone-zero", "arknights", "muse-dash", "your-name",
              "princess-mononoke", "bocchi-the-rock", "virtual-youtuber", "magical-girl"],
    "games": ["minecraft", "call-of-duty", "grand-theft-auto", "gta"],
    "cars": ["bmw", "porsche", "mclaren", "drifting"],
    "nature": ["mountain", "lake", "sunset", "sunrise", "sakura", "cherry", "valley", "fog", 
               "campfire", "field", "garden", "tree", "river"],
    "fantasy": ["fantasy", "medieval", "castle", "astronaut", "space", "ufo", "samurai", "pirate"],
    "misc": []  # Default category
}

def get_category(filename):
    """Determine category based on filename keywords"""
    filename_lower = filename.lower()
    for category, keywords in categories.items():
        if category == "misc":
            continue
        for keyword in keywords:
            if keyword in filename_lower:
                return category
    return "misc"

def format_name(filename):
    """Convert filename to display name"""
    name = os.path.splitext(filename)[0]
    # Replace hyphens with spaces and title case
    return name.replace("-", " ").title()

# Load existing JSON
with open(json_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Group videos by category
categorized_videos = {}
for video_file in video_files:
    category = get_category(video_file)
    if category not in categorized_videos:
        categorized_videos[category] = []
    categorized_videos[category].append(video_file)

# Sort videos within each category alphabetically
for category in categorized_videos:
    categorized_videos[category].sort()

# Define category order for better organization
category_order = ["anime", "games", "cars", "nature", "fantasy", "misc"]

# Build new videos array
new_videos = []
video_id = 1

for category in category_order:
    if category not in categorized_videos:
        continue
    
    for video_file in categorized_videos[category]:
        video_name = os.path.splitext(video_file)[0]
        thumbnail_name = video_name + ".jpg"
        
        video_entry = {
            "id": f"vid-{video_id:03d}",
            "name": format_name(video_file),
            "category": category,
            "asset": f"{base_url}/video/{video_file}",
            "thumbnail": f"{base_url}/video/thumbnail/{thumbnail_name}"
        }
        new_videos.append(video_entry)
        video_id += 1

# Update the JSON data
data["videos"] = new_videos

# Update version to today's date
from datetime import datetime
data["version"] = datetime.now().strftime("%Y.%m.%d")

# Write updated JSON
with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"Updated wallpaper.json with {len(new_videos)} videos")
print("\nVideos by category:")
for category in category_order:
    if category in categorized_videos:
        print(f"  {category}: {len(categorized_videos[category])} videos")
