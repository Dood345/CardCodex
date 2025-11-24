package com.independent.cardcodex.data

import com.google.gson.annotations.SerializedName

data class MasterManifest(
    @SerializedName("monsters_source") val monstersSource: String,
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
    val set: String,
    @SerializedName("image") val imageUrl: String
)
