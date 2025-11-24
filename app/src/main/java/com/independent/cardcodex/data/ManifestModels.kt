package com.independent.cardcodex.data

import com.google.gson.annotations.SerializedName

data class MasterManifest(
    @SerializedName("monsters_source") val monstersSource: MonstersSource,
    @SerializedName("sets_source") val setsSource: List<SetsSource>
)

data class MonstersSource(
    val url: String
)

data class SetsSource(
    val url: String
)

// For parsing the Monsters JSON
data class MonsterEntry(
    val id: Int,
    val name: String,
    val types: List<String>
)

// For parsing the Cards JSON
data class CardEntry(
    val id: String,
    val name: String,
    val set: String,
    @SerializedName("image") val imageUrl: String
)
