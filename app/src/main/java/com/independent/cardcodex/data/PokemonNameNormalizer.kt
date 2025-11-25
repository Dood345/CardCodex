package com.independent.cardcodex.data

object PokemonNameNormalizer {
    private val suffixes = listOf(
        " V", " VMAX", " VSTAR", " EX", " GX", " LV.X", " BREAK", " ex", " Star"
    )
    
    private val prefixes = listOf(
        "Dark ", "Light ", "Rocket's ", "Erika's ", "Misty's ", "Brock's ", "Lt. Surge's ", "Blaine's ", "Giovanni's ", "Sabrina's ", "Koga's "
    )

    fun normalize(rawName: String): String {
        var normalized = rawName
        
        // Remove suffixes
        suffixes.forEach { suffix ->
            if (normalized.endsWith(suffix)) {
                normalized = normalized.removeSuffix(suffix)
            }
        }
        
        // Remove prefixes
        prefixes.forEach { prefix ->
            if (normalized.startsWith(prefix)) {
                normalized = normalized.removePrefix(prefix)
            }
        }
        
        // Special case for "Shining"
        if (normalized.startsWith("Shining ")) {
            normalized = normalized.removePrefix("Shining ")
        }

        return normalized.trim()
    }
}
