
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import cv2
import numpy as np

# Test mediapipe installation
print(f"MediaPipe version: {mp.__version__}")
print(f"Tasks available: {dir(mp.tasks)}")
print(f"Vision tasks available: {dir(mp.tasks.vision)}")

# Try to create a pose landmarker
try:
    # Create a pose landmarker instance with the video mode:
    base_options = python.BaseOptions(model_asset_path='pose_landmarker_full.task')
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        output_segmentation_masks=True)
    
    detector = vision.PoseLandmarker.create_from_options(options)
    print("Pose detector created successfully")
    
except Exception as e:
    print(f"Error creating pose detector: {e}")
    import traceback
    traceback.print_exc()

# Try to load a test image
try:
    # Load a test image from the internet or local file
    test_img_path = 'test_image.jpg'
    
    # Read the image
    image = cv2.imread(test_img_path)
    if image is not None:
        print(f"Test image loaded successfully: {image.shape}")
        
        # Convert to RGB
        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        # Convert to mediapipe image object
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_image)
        
        # Detect pose
        results = detector.detect(mp_image)
        print(f"Pose detection results: {results}")
        
        if results.pose_landmarks:
            print(f"Number of poses detected: {len(results.pose_landmarks)}")
            for i, landmarks in enumerate(results.pose_landmarks):
                print(f"Pose {i} - {len(landmarks)} landmarks")
                # Calculate average visibility
                avg_visibility = np.mean([lm.visibility for lm in landmarks])
                print(f"Pose {i} - Average visibility: {avg_visibility:.2f}")
                
except Exception as e:
    print(f"Error processing test image: {e}")
    import traceback
    traceback.print_exc()
