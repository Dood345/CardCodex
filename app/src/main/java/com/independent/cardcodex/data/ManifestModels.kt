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

data class CardImages(
    val small: String,
    val large: String
)

// New data classes for detailed card information
data class Ability(
    val name: String,
    val text: String,
    val type: String
)

data class Attack(
    val name: String,
    val cost: List<String>,
    val convertedEnergyCost: Int,
    val damage: String?,
    val text: String
)

data class Weakness(
    val type: String,
    val value: String
)

data class Legalities(
    val unlimited: String?
)

// Updated CardEntry to include all new fields
data class CardEntry(
    val id: String,
    val name: String,
    val supertype: String?,
    val subtypes: List<String>?,
    val level: String?,
    val hp: String?,
    val types: List<String>?,
    val evolvesFrom: String?,
    val evolvesTo: List<String>?,
    val rules: List<String>?,
    val abilities: List<Ability>?,
    val attacks: List<Attack>?,
    val weaknesses: List<Weakness>?,
    val retreatCost: List<String>?,
    val convertedRetreatCost: Int?,
    val number: String?,
    val artist: String?,
    val rarity: String?,
    val flavorText: String?,
    val nationalPokedexNumbers: List<Int>?,
    val legalities: Legalities?,
    @SerializedName("images") val images: CardImages
)
