package com.independent.cardcodex.data

import com.google.gson.annotations.SerializedName

data class MasterManifest(
    @SerializedName("monsters_source") val monstersSource: String,
    @SerializedName("energy_icons_base_url") val energyIconsBaseUrl: String?,
    @SerializedName("sets_source") val setsSource: List<String>
)

// For parsing the Monsters JSON
data class MonsterEntry(
    val id: Int,
    val name: NameEntry,
    @SerializedName("type") val types: List<String>
)

data class NameEntry(
    val english: String
)

// For parsing the Cards JSON

data class CardEntry(
    val id: String,
    val name: String,
    val supertype: String?,
    val subtypes: List<String>?,
    val types: List<String>?,
    @SerializedName("images") val images: CardImages
)

data class CardImages(
    val small: String,
    val large: String
)
