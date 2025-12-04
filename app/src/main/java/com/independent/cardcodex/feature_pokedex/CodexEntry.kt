package com.independent.cardcodex.feature_pokedex

data class CodexEntry(
    val id: String, // specific ID or Name
    val name: String,
    val iconUrl: String,
    val type: String?,
    val isSpecies: Boolean,
    val speciesId: Int? = null
)
