package com.independent.cardcodex.ui.util

import javax.inject.Inject
import android.content.SharedPreferences

class EnergyIconProvider @Inject constructor(
    private val prefs: SharedPreferences
) {
    fun getIconUrl(type: String?): String? {
        val baseUrl = prefs.getString("energy_icons_base_url", "https://raw.githubusercontent.com/duiker101/pokemon-type-svg-icons/master/icons/")
        
        val filename = when (type?.lowercase()) {
            "grass" -> "grass.svg"
            "fire" -> "fire.svg"
            "water" -> "water.svg"
            "lightning", "electric" -> "electric.svg"
            "psychic" -> "psychic.svg"
            "fighting" -> "fighting.svg"
            "darkness", "dark" -> "dark.svg"
            "metal", "steel" -> "steel.svg"
            "fairy" -> "fairy.svg"
            "dragon" -> "dragon.svg"
            "colorless", "normal" -> "normal.svg"
            else -> null
        }

        return if (filename != null && baseUrl != null) {
             "$baseUrl$filename"
        } else {
            null
        }
    }
}
