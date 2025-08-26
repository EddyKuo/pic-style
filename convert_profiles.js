const fs = require('fs');

// Load the original, complex JSON file
const originalProfilesPath = './film_profiles.json'; // Assuming you save your file with this name
const originalData = JSON.parse(fs.readFileSync(originalProfilesPath, 'utf-8'));

const newProfiles = [];

for (const profile of originalData.film_profiles) {
    const params = profile.engine_parameters;
    
    // Map the nested structure to our flat structure
    // Also, scale/adjust values to match what our UI sliders expect
    const newEngineParams = {
        temperature: params.color.temperature || 0,
        tint: params.color.tint || 0,
        vibrance: params.color.vibrance || 0,
        // Note: We are ignoring saturation as it's not in our current UI
        
        grainIntensity: (params.grain.intensity || 0) * 100, // Convert 0-1 scale to 0-100
        grainSize: params.grain.size || 1.5,
        grainRoughness: params.grain.roughness || 0.5,
        grainMono: params.grain.monochromatic || false,
        
        halationIntensity: params.halation.intensity || 0,
        halationRadius: params.halation.radius || 25,
        halationThreshold: params.halation.threshold || 0.9,
        // Note: We are ignoring halation color as it's not in our current UI
        
        vignetteIntensity: params.vignette.intensity || 0.2,
        // Note: We are ignoring vignette feather as it's not in our current UI
    };

    newProfiles.push({
        id: profile.id,
        name: profile.name,
        lut_3d: params.color.lut_3d,
        engine_parameters: newEngineParams
    });
}

// Write the new, compatible JSON file
const newProfilesPath = './pic-styles.json';
fs.writeFileSync(newProfilesPath, JSON.stringify(newProfiles, null, 2));

console.log(`Successfully converted ${newProfiles.length} profiles to '${newProfilesPath}'`);
